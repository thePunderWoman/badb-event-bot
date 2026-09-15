import { Firestore } from "@google-cloud/firestore";

// Tracks which Discord Scheduled Event IDs have already been posted to the
// public announcement channel, so the create_event button handler and the
// pollScheduledEvents poller (which also catches manually-created events)
// never announce the same event twice.
const COLLECTION = "announcedEvents";
const firestore = new Firestore();

export async function hasBeenAnnounced(eventId: string): Promise<boolean> {
  const doc = await firestore.collection(COLLECTION).doc(eventId).get();
  return doc.exists;
}

export async function markAnnounced(eventId: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(eventId).set({ announcedAt: new Date().toISOString() });
}
