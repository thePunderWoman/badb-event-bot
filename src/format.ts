// BADB events are local to the Bay Area. Cloud Functions runs in UTC, so
// every displayed time must name this zone explicitly — otherwise a 6 PM
// Pacific event renders as 1 AM the next day.
export const EVENT_TIME_ZONE = "America/Los_Angeles";

// Calendar all-day events carry a bare date (YYYY-MM-DD) rather than a
// dateTime. Those have no time of day, so they're shown as just the date,
// in UTC, where JavaScript parses them — converting to Pacific would roll
// them back to the previous evening.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatDateTime(iso: string): string {
  if (DATE_ONLY.test(iso)) {
    return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
  }
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: EVENT_TIME_ZONE });
}

// Shared display formatting for event times, used in the admin request
// embed, Discord announcements, and the digest email. Always shows the full
// date on both ends (not just a bare end time) since events can span
// multiple days.
export function formatEventWhen(startIso: string, endIso?: string): string {
  const startDisplay = formatDateTime(startIso);
  if (!endIso) return startDisplay;
  return `${startDisplay} – ${formatDateTime(endIso)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeStyle: "short", timeZone: EVENT_TIME_ZONE });
}

// Falls back to a 3-hour block when the form (or a manually-created event)
// doesn't specify an end time.
export function resolveEndIso(startIso: string, endIso?: string): string {
  return endIso ?? new Date(new Date(startIso).getTime() + 3 * 60 * 60 * 1000).toISOString();
}

// Discord's Scheduled Event (and Google Calendar) have no dedicated "arrival
// time" or "event type" fields, so fold them into the description text.
export function buildRichDescription(description: string, eventType?: string, arrivalIso?: string): string {
  const typeNote = eventType ? `Type: ${eventType}\n\n` : "";
  const arrivalNote = arrivalIso ? `Arrival: ${formatTime(arrivalIso)}\n\n` : "";
  return `${typeNote}${arrivalNote}${description}`;
}
