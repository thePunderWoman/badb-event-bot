// Shared display formatting for event times, used in the admin request
// embed, Discord announcements, and the digest email. Always shows the full
// date on both ends (not just a bare end time) since events can span
// multiple days.
export function formatEventWhen(startIso: string, endIso?: string): string {
  const startDisplay = new Date(startIso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  if (!endIso) return startDisplay;
  const endDisplay = new Date(endIso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return `${startDisplay} – ${endDisplay}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeStyle: "short" });
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
