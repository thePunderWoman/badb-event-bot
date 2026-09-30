import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import type { calendar_v3 } from "googleapis";
import { createGuildScheduledEvent, postChannelMessage, updateGuildScheduledEvent } from "./discordApi";
import { EventMapping, getEventMapping, getSyncToken, saveEventMapping, saveSyncToken } from "./eventSync";
import { formatCalendarEventWhen } from "./format";
import { listCalendarChanges } from "./googleCalendar";

// GUILD_SCHEDULED_EVENT_ENTITY_TYPE.EXTERNAL — since droid meetups happen at
// physical venues rather than in a Discord voice channel.
const ENTITY_TYPE_EXTERNAL = 3;
const EVENT_STATUS_SCHEDULED = 1;
const EVENT_STATUS_CANCELED = 4;
const PRIVACY_LEVEL_GUILD_ONLY = 2;

function extractFields(event: calendar_v3.Schema$Event) {
  return {
    summary: event.summary || "Untitled event",
    description: event.description || "",
    startIso: event.start?.dateTime ?? event.start?.date ?? "",
    endIso: event.end?.dateTime ?? event.end?.date ?? "",
    location: event.location || "",
  };
}

function hasMeaningfulChange(a: EventMapping, b: ReturnType<typeof extractFields>): boolean {
  return (
    a.summary !== b.summary ||
    a.description !== b.description ||
    a.startIso !== b.startIso ||
    a.endIso !== b.endIso ||
    a.location !== b.location
  );
}

// Google Calendar is the source of truth for events; this mirrors it into
// Discord. Invoked on a schedule (Cloud Scheduler, every few minutes)
// rather than by Discord or Calendar directly. Uses Calendar's incremental
// sync (a syncToken) so each run only sees what actually changed —
// created, updated, or cancelled — since the last run.
http("pollScheduledEvents", async (_req: Request, res: Response) => {
  const guildId = process.env.DISCORD_GUILD_ID;
  const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!guildId || !announcementChannelId || !calendarId) {
    res.status(500).send("DISCORD_GUILD_ID / DISCORD_ANNOUNCEMENT_CHANNEL_ID / GOOGLE_CALENDAR_ID not set");
    return;
  }

  const syncToken = await getSyncToken();
  const { events, nextSyncToken } = await listCalendarChanges(calendarId, syncToken);

  let created = 0;
  let updated = 0;
  let cancelled = 0;

  for (const event of events) {
    if (!event.id) continue;

    try {
      const mapping = await getEventMapping(event.id);

      if (event.status === "cancelled") {
        if (mapping && mapping.status !== "cancelled") {
          await updateGuildScheduledEvent(guildId, mapping.discordEventId, { status: EVENT_STATUS_CANCELED });
          await postChannelMessage(announcementChannelId, {
            embeds: [{ title: `🚫 EVENT CANCELLED: ${mapping.summary}`, color: 0xe74c3c }],
          });
          await saveEventMapping(event.id, { ...mapping, status: "cancelled" });
          cancelled++;
        }
        continue;
      }

      const fields = extractFields(event);

      if (!mapping) {
        const discordEvent = await createGuildScheduledEvent(guildId, {
          name: fields.summary,
          privacy_level: PRIVACY_LEVEL_GUILD_ONLY,
          scheduled_start_time: fields.startIso,
          scheduled_end_time: fields.endIso,
          description: fields.description,
          entity_type: ENTITY_TYPE_EXTERNAL,
          entity_metadata: { location: fields.location || "TBD" },
          status: EVENT_STATUS_SCHEDULED,
        });
        await postChannelMessage(announcementChannelId, {
          embeds: [
            {
              title: `📅 New event: ${fields.summary}`,
              description: fields.description || undefined,
              color: 0x2ecc71,
              fields: [
                { name: "When", value: formatCalendarEventWhen(fields.startIso, fields.endIso), inline: true },
                ...(fields.location ? [{ name: "Where", value: fields.location, inline: true }] : []),
              ],
            },
          ],
        });
        await saveEventMapping(event.id, { discordEventId: discordEvent.id, status: "active", ...fields });
        created++;
      } else if (hasMeaningfulChange(mapping, fields)) {
        await updateGuildScheduledEvent(guildId, mapping.discordEventId, {
          name: fields.summary,
          scheduled_start_time: fields.startIso,
          scheduled_end_time: fields.endIso,
          description: fields.description,
          entity_metadata: { location: fields.location || "TBD" },
        });
        await postChannelMessage(announcementChannelId, {
          embeds: [
            {
              title: `🔄 EVENT UPDATE: ${fields.summary}`,
              description: fields.description || undefined,
              color: 0xf1c40f,
              fields: [
                { name: "When", value: formatCalendarEventWhen(fields.startIso, fields.endIso), inline: true },
                ...(fields.location ? [{ name: "Where", value: fields.location, inline: true }] : []),
              ],
            },
          ],
        });
        await saveEventMapping(event.id, { discordEventId: mapping.discordEventId, status: "active", ...fields });
        updated++;
      }
    } catch (err) {
      // Leave this event's mapping/state as-is so the next poll retries it.
      console.error(`Failed to sync calendar event ${event.id}`, err);
    }
  }

  // Advance the cursor even if some individual events failed above — a
  // stuck cursor would mean re-processing the whole backlog every run.
  await saveSyncToken(nextSyncToken);

  res.status(200).send(`checked ${events.length}, created ${created}, updated ${updated}, cancelled ${cancelled}`);
});
