import type { calendar_v3 } from "googleapis";
import { getCalendarClient } from "./googleAuth";

export interface CalendarChanges {
  events: calendar_v3.Schema$Event[];
  nextSyncToken: string;
}

function isGoneError(err: any): boolean {
  const status = err?.code ? Number(err.code) : err?.response?.status;
  return status === 410;
}

async function fetchChanges(calendarId: string, syncToken?: string): Promise<CalendarChanges> {
  const calendar = await getCalendarClient();
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const res = await calendar.events.list({
      calendarId,
      syncToken,
      pageToken,
      singleEvents: true,
      showDeleted: true,
    });
    events.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    nextSyncToken = res.data.nextSyncToken ?? undefined;
  } while (pageToken);

  if (!nextSyncToken) throw new Error("Calendar API did not return a nextSyncToken");
  return { events, nextSyncToken };
}

// Wraps events.list with incremental sync — each call returns only what
// changed (created/updated/cancelled) since the last syncToken. On first
// call (no syncToken) or after a token expires (410 Gone), falls back to a
// full resync; that's safe because already-mirrored events are recognized
// via their Firestore mapping (src/eventSync.ts) rather than recreated.
export async function listCalendarChanges(calendarId: string, syncToken?: string): Promise<CalendarChanges> {
  try {
    return await fetchChanges(calendarId, syncToken);
  } catch (err) {
    if (syncToken && isGoneError(err)) {
      return await fetchChanges(calendarId);
    }
    throw err;
  }
}

export async function createCalendarEvent(params: {
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  location: string;
}): Promise<string> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is not set");

  const calendar = await getCalendarClient();
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: params.title,
      description: params.description,
      location: params.location,
      start: { dateTime: params.startIso },
      end: { dateTime: params.endIso },
    },
  });

  if (!res.data.id) throw new Error("Calendar API did not return an event id");
  return res.data.id;
}
