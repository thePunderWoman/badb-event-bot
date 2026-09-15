// Shape of the JSON the Apps Script trigger POSTs to /form-submit.
// startIso/endIso MUST be full ISO8601 strings (e.g. 2026-10-04T18:00:00-07:00)
// since these are what Discord's Scheduled Event API requires.
export interface EventRequestPayload {
  title: string;
  startIso: string;
  endIso?: string;
  location: string;
  description: string;
  requesterName: string;
  requesterEmail?: string;
  formResponseUrl?: string;
}

// What we stash in the embed footer so the /interactions handler can
// reconstruct the event without needing a database.
export interface StashedEventData extends EventRequestPayload {
  v: 1;
}
