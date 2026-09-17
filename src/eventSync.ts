import { Firestore } from "@google-cloud/firestore";

// Google Calendar is the source of truth; this tracks how each Calendar
// event maps to its mirrored Discord Scheduled Event, plus the last-known
// field values (used to detect whether a change is meaningful enough to
// warrant an "EVENT UPDATE" announcement) and the incremental-sync cursor.
const firestore = new Firestore();
const EVENTS_COLLECTION = "calendarEvents";
const SYNC_STATE_DOC = firestore.collection("calendarSync").doc("state");

export interface EventMapping {
  discordEventId: string;
  status: "active" | "cancelled";
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  location: string;
}

export async function getSyncToken(): Promise<string | undefined> {
  const snap = await SYNC_STATE_DOC.get();
  return snap.data()?.syncToken;
}

export async function saveSyncToken(syncToken: string): Promise<void> {
  await SYNC_STATE_DOC.set({ syncToken }, { merge: true });
}

export async function getEventMapping(calendarEventId: string): Promise<EventMapping | undefined> {
  const doc = await firestore.collection(EVENTS_COLLECTION).doc(calendarEventId).get();
  return doc.data() as EventMapping | undefined;
}

export async function saveEventMapping(calendarEventId: string, mapping: EventMapping): Promise<void> {
  await firestore.collection(EVENTS_COLLECTION).doc(calendarEventId).set(mapping);
}
