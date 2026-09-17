# BADB Event Bot

Google Form submission → admin approval in Discord → Google Calendar. From
there, **Google Calendar is the single source of truth** for public events —
it's shared on the website and members subscribe to it directly. Discord
(the `#events` channel and Discord's own Scheduled Events) and a bi-weekly
email are downstream notification channels that mirror whatever is on the
Calendar; nothing is ever written back from Discord to Calendar.

## Architecture

- **`formSubmit`** (Cloud Function): receives a POST from the Apps Script
  trigger, posts a formatted embed with **Approve** / **Dismiss** buttons
  into your admin channel.
- **`interactions`** (Cloud Function): Discord's required Interactions
  Endpoint. Verifies the request is really from Discord, then on
  **Approve** adds the event to Google Calendar — nothing else. The Discord
  event and public announcement follow automatically once `pollScheduledEvents`
  picks up the new Calendar entry.
- **`pollScheduledEvents`** (Cloud Function, run every 5 minutes via Cloud
  Scheduler): the core sync. Uses the Calendar API's incremental sync (a
  `syncToken`, stored in Firestore) so each run only sees what actually
  changed since the last one — created, updated, or cancelled — rather than
  re-scanning everything. For each change it mirrors the corresponding
  Discord Scheduled Event (create / update / mark CANCELED) and posts to
  the public `#events` channel: "📅 New event", "🔄 EVENT UPDATE", or
  "🚫 EVENT CANCELLED". An event created directly in Discord (bypassing
  Calendar) is intentionally never picked up — Calendar is the only
  supported entry point.
- **`sendEventDigest`** (Cloud Function, run weekly via Cloud Scheduler but
  only actually sends every other run — see below): lists upcoming Calendar
  events, posts the list to `#events`, and emails the same list to the
  R2SF Google Group via Gmail SMTP.

Firestore (`(default)` database, Native mode) holds two small collections:
`calendarEvents` (Calendar event ID → mirrored Discord event ID + last-seen
fields, so updates/cancellations can be detected and applied idempotently)
and `calendarSync` (the incremental sync cursor). `digestState` holds the
bi-weekly on/off toggle.

## One-time setup

1. Complete the Discord Developer Portal steps (app, bot, permissions,
   public key, guild/channel IDs) — see the walkthrough you were given
   alongside this code. The bot's role needs **Manage Events** (guild-wide)
   and **View Channel + Send Messages** on both the admin channel and the
   public `#events` channel.
2. Share your Google Calendar with this project's default compute service
   account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`),
   permission **Make changes to events**. Grab its Calendar ID from
   Calendar Settings > Integrate calendar.
3. Enable 2-Step Verification on the Google account that should send the
   digest email, then create an **App password** (Google Account > Security
   > 2-Step Verification > App passwords).
4. `cp .env.yaml.example .env.yaml` and fill in the real values.
5. Install deps: `npm install`
6. Enable the required GCP APIs and create the Firestore database (one-time,
   per project):
   ```
   gcloud services enable cloudfunctions.googleapis.com run.googleapis.com \
     cloudbuild.googleapis.com artifactregistry.googleapis.com \
     eventarc.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com \
     calendar-json.googleapis.com
   gcloud firestore databases create --location=us-west1 --type=firestore-native
   ```
7. Deploy all four functions:
   ```
   npm run deploy:form-submit
   npm run deploy:interactions
   npm run deploy:poll-scheduled-events
   npm run deploy:send-event-digest
   ```
   The first two print a **Trigger URL** — save both. `pollScheduledEvents`
   and `sendEventDigest` are deployed with `--no-allow-unauthenticated`
   since only Cloud Scheduler should be able to call them.
8. In the Discord Developer Portal, paste the `interactions` function's URL
   into **Interactions Endpoint URL** and save. Discord will immediately
   send a PING to verify it; if the deploy above succeeded this passes
   automatically.
9. In the Google Sheet collecting form responses: **Extensions > Apps
   Script**, paste in `appsscript/onFormSubmit.js`, update
   `FORM_SUBMIT_URL` (the `formSubmit` trigger URL from step 7) and
   `SHARED_SECRET` (must match `.env.yaml`'s `FORM_SHARED_SECRET`), then
   set the `COLUMNS` mapping to match your actual form's question order.
10. Add a trigger: clock icon on the left > **Add Trigger** > function
    `onFormSubmit` > event source **From spreadsheet** > event type
    **On form submit** > Save.
11. Wire up both schedules, letting each function invoke itself via its own
    service account:
    ```
    gcloud functions add-invoker-policy-binding badb-poll-scheduled-events \
      --region=us-west1 \
      --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com"
    gcloud scheduler jobs create http badb-poll-scheduled-events \
      --location=us-west1 \
      --schedule="*/5 * * * *" \
      --uri="<pollScheduledEvents trigger URL>" \
      --http-method=POST \
      --oidc-service-account-email="PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
      --oidc-token-audience="<pollScheduledEvents trigger URL>"

    gcloud functions add-invoker-policy-binding badb-send-event-digest \
      --region=us-west1 \
      --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com"
    gcloud scheduler jobs create http badb-send-event-digest \
      --location=us-west1 \
      --schedule="0 8 * * 1" \
      --time-zone="America/Los_Angeles" \
      --uri="<sendEventDigest trigger URL>" \
      --http-method=POST \
      --oidc-service-account-email="PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
      --oidc-token-audience="<sendEventDigest trigger URL>"
    ```
    `sendEventDigest` runs weekly but only actually sends every other
    invocation (a Firestore-backed toggle) — a real "every 2 weeks" cron
    schedule doesn't exist, so this is the standard workaround. Pass
    `?force=true` to its URL to bypass the skip when testing manually.

## Testing

Submit a test response through the actual Google Form (Apps Script
`onFormSubmit` triggers don't fire from manually editing the sheet). You
should see the embed appear in the admin channel within a few seconds.
Click **Approve** and confirm the event shows up in Google Calendar —
Discord and the `#events` announcement follow within the next
`pollScheduledEvents` run (or trigger it manually with
`gcloud scheduler jobs run badb-poll-scheduled-events --location=us-west1`).

## Notes / things you may want to tweak

- Events are created as `EXTERNAL` (physical location) rather than tied to
  a voice channel — change `entity_type` in `pollScheduledEvents.ts` if
  that's ever wrong for a meetup.
- The form collects an explicit End Time, but `resolveEndIso` in
  `format.ts` still falls back to a 3-hour block if `endIso` is ever
  missing.
- Only meaningful field changes (title, start/end time, location,
  description) trigger an "EVENT UPDATE" — incidental Calendar metadata
  touches are ignored, so `#events` doesn't get noisy.
- Cancelling/deleting a Calendar event marks the mirrored Discord event
  **CANCELED** rather than deleting it, so it stays visible (greyed out) to
  anyone who had saved it.
- If you ever want role-gating on who can click the admin buttons, the
  member's roles are available on `interaction.member.roles` inside the
  handler.
- Local testing: `npm run start:form-submit`, `start:interactions`,
  `start:poll-scheduled-events`, or `start:send-event-digest` runs the
  Functions Framework locally; use a tool like `ngrok` to expose it if you
  need Discord to actually reach it during dev.
