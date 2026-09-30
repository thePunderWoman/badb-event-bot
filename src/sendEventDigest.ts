import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import { Firestore } from "@google-cloud/firestore";
import type { calendar_v3 } from "googleapis";
import nodemailer from "nodemailer";
import { postChannelMessage } from "./discordApi";
import { formatEventWhen } from "./format";
import { getCalendarClient } from "./googleAuth";

const firestore = new Firestore();
const DIGEST_STATE_DOC = firestore.collection("digestState").doc("state");
const MAILING_LIST_ADDRESS = "R2SF@googlegroups.com";
const CALENDAR_VIEW_URL = "https://calendar.google.com/calendar/embed?src=" + encodeURIComponent(process.env.GOOGLE_CALENDAR_ID ?? "");

// Runs weekly via Cloud Scheduler but only actually sends every other run,
// giving a true bi-weekly cadence without relying on fragile day-of-month
// cron math (cron has no native "every 2 weeks"). The toggle only flips
// after a successful run, so a mid-run failure doesn't burn a cycle — the
// next scheduled run will retry instead of skipping. Pass ?force=true to
// bypass the skip for manual testing (doesn't touch the toggle either way).
async function isDueThisRun(): Promise<boolean> {
  const snap = await DIGEST_STATE_DOC.get();
  return snap.data()?.dueNext !== false; // defaults to true if the doc doesn't exist yet
}

async function flipDueState(): Promise<void> {
  const dueNow = await isDueThisRun();
  await DIGEST_STATE_DOC.set({ dueNext: !dueNow }, { merge: true });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Google Calendar's all-day end date is exclusive — a 3-day all-day event
// (25th-27th) stores end.date as the 28th. Shift it back a day so the
// digest shows the last real day of the event instead of the day after.
function eventWhen(event: calendar_v3.Schema$Event): string {
  const isAllDay = !event.start?.dateTime;
  const startIso = event.start?.dateTime ?? event.start?.date ?? "";
  let endIso = event.end?.dateTime ?? event.end?.date ?? undefined;
  if (endIso && isAllDay) {
    const d = new Date(endIso);
    d.setUTCDate(d.getUTCDate() - 1);
    endIso = d.toISOString().slice(0, 10); // keep it a bare date so it's formatted as one
  }
  return formatEventWhen(startIso, endIso);
}

// Callers only invoke this with a non-empty list — sendEventDigest skips
// sending entirely when there's nothing upcoming.
function buildPlainTextBody(events: calendar_v3.Schema$Event[]): string {
  const eventsBlock = events
    .map((event) => {
      const when = eventWhen(event);
      const lines = [event.summary || "Untitled event", when];
      if (event.location) lines.push(event.location);
      if (event.description) lines.push(event.description);
      return lines.join("\n");
    })
    .join("\n\n");

  return [
    "Hey Builders!",
    "",
    "Here's your digest of the upcoming events for the Bay Area Droid Builders:",
    "",
    eventsBlock,
    "",
    "Thanks and may the force be with you!",
    "Bay Area Droid Builders",
  ].join("\n");
}

function buildEmailHtml(events: calendar_v3.Schema$Event[]): string {
  const eventsHtml = events
    .map((event) => {
      const when = eventWhen(event);
      const location = event.location ? `<br>${escapeHtml(event.location)}` : "";
      const description = event.description ? `<br>${escapeHtml(event.description)}` : "";
      return `<p><strong>${escapeHtml(event.summary || "Untitled event")}</strong><br>${escapeHtml(when)}${location}${description}</p>`;
    })
    .join("");

  return `
<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #222;">
  <p>Hey Builders!</p>
  <p>Here's your digest of the upcoming events for the Bay Area Droid Builders:</p>
  ${eventsHtml}
  <p>
    See the full, always-up-to-date calendar any time:
    <a href="${CALENDAR_VIEW_URL}" style="color: #8a2be2;">Bay Area Droid Builders Calendar</a>
  </p>
  <p>Thanks and may the force be with you!<br>Bay Area Droid Builders</p>
</div>
`.trim();
}

async function sendDigestEmail(subject: string, text: string, html: string, to: string): Promise<void> {
  const user = process.env.GMAIL_SENDER_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_SENDER_EMAIL / GMAIL_APP_PASSWORD is not set");

  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transporter.sendMail({
    from: `Bay Area Droid Builders <${user}>`,
    to,
    subject,
    text,
    html,
  });
}

http("sendEventDigest", async (req: Request, res: Response) => {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  if (!calendarId || !announcementChannelId) {
    res.status(500).send("GOOGLE_CALENDAR_ID / DISCORD_ANNOUNCEMENT_CHANNEL_ID not set");
    return;
  }

  const force = req.query?.force === "true";
  if (!force && !(await isDueThisRun())) {
    res.status(200).send("skipped — not due this week");
    return;
  }

  const calendar = await getCalendarClient();
  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events = eventsRes.data.items ?? [];
  if (events.length === 0) {
    // Nothing to report — still counts as this cycle's run so the
    // bi-weekly cadence stays on schedule, just with nothing sent.
    if (!force) await flipDueState();
    res.status(200).send("skipped — no upcoming events");
    return;
  }

  const plainTextBody = buildPlainTextBody(events);
  const subject = "Upcoming Bay Area Droid Builder Events";

  // ?to=<email> overrides the recipient for manual testing, so a test run
  // never actually reaches the real mailing list.
  const testRecipient = typeof req.query?.to === "string" ? req.query.to : undefined;
  const recipient = testRecipient || MAILING_LIST_ADDRESS;

  await postChannelMessage(announcementChannelId, {
    embeds: [{ title: "📋 Upcoming Events", description: plainTextBody, color: 0x8a2be2 }],
  });
  await sendDigestEmail(subject, plainTextBody, buildEmailHtml(events), recipient);

  if (!force) await flipDueState();
  res.status(200).send(`sent digest with ${events.length} event(s) to ${recipient}`);
});
