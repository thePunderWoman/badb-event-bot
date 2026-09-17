import { google } from "googleapis";

// Uses Application Default Credentials — inside Cloud Functions this is
// automatically the function's own runtime service account
// (…-compute@developer.gserviceaccount.com). No key file to manage: just
// share the target Calendar with that service account's email.
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
});

export async function getCalendarClient() {
  const authClient = await auth.getClient();
  return google.calendar({ version: "v3", auth: authClient as any });
}
