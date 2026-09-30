import { buildRichDescription, resolveEndIso } from "./format";
import { createCalendarEvent } from "./googleCalendar";
import { StashedEventData } from "./types";

// The body of a PATCH to the admin request message. Leaving `components`
// out keeps the Approve/Dismiss buttons, so a failed attempt can be retried.
export interface MessageEdit {
  embeds: any[];
  components?: unknown[];
}

const MAX_REASON_LENGTH = 200;

function parseStash(footerText: string | undefined): StashedEventData | null {
  if (!footerText) return null;
  try {
    return JSON.parse(footerText);
  } catch {
    return null;
  }
}

// Each request gets its own admin message, so its Discord message ID
// (a numeric snowflake, which is valid base32hex) yields a Calendar event ID
// that is stable across every click on that message.
export function calendarEventIdForRequest(messageId: string): string {
  return `badb${messageId}`;
}

// Works out what an Approve/Dismiss click on an admin request message does,
// performs it, and returns the edit that reports the outcome on the message.
// Never throws: a failure comes back as an edit explaining it. Returns null
// for buttons this bot didn't create.
export async function handleEventRequestAction(customId: string | undefined, messageId: string, embed: any): Promise<MessageEdit | null> {
  const stashed = parseStash(embed.footer?.text);
  const title = stashed?.title ?? embed.title?.replace(/^New event request: /, "") ?? "";

  if (customId === "dismiss") {
    // description is cleared (undefined is dropped from the JSON, and Discord
    // replaces the whole embed) in case an earlier failed attempt set one.
    return { embeds: [{ ...embed, color: 0x555555, title: `❌ Dismissed — ${title}`, description: undefined }], components: [] };
  }

  if (customId !== "create_event") return null;

  if (!stashed) {
    return failureEdit(embed, title, "The event details on this message couldn't be read, so nothing was added to Calendar.");
  }

  // Approving only adds the event to Google Calendar — Calendar is the
  // source of truth, so the Discord Scheduled Event and the #events
  // announcement are created automatically by pollScheduledEvents.ts once
  // it picks up this new Calendar event (within a few minutes).
  try {
    await createCalendarEvent({
      id: calendarEventIdForRequest(messageId),
      title: stashed.title,
      description: buildRichDescription(stashed.description, stashed.eventType, stashed.arrivalIso),
      startIso: stashed.startIso,
      endIso: resolveEndIso(stashed.startIso, stashed.endIso),
      location: stashed.location,
    });
  } catch (err) {
    console.error(err);
    const reason = String((err as any)?.message ?? err).slice(0, MAX_REASON_LENGTH);
    return failureEdit(
      embed,
      title,
      `Couldn't add this to Google Calendar: ${reason}\n\nClick **Approve** again to retry. It won't create a duplicate event.`,
    );
  }

  return {
    embeds: [{ ...embed, color: 0x2ecc71, title: `✅ Approved — added to Calendar: ${title}`, description: undefined }],
    components: [],
  };
}

function failureEdit(embed: any, title: string, explanation: string): MessageEdit {
  return { embeds: [{ ...embed, color: 0xe74c3c, title: `⚠️ Not added to Calendar — ${title}`, description: explanation }] };
}
