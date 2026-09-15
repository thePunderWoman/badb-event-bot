# BADB Event Bot

Google Form submission → Discord admin channel notification → one-click
Discord Scheduled Event creation → public announcement. The event request
data lives in the Discord message itself (JSON tucked into the embed
footer) and is parsed back out when a button is clicked — no database for
that part. A small Firestore collection is used separately, just to track
which event IDs have already been announced publicly (see below).

## Architecture

- **`formSubmit`** (Cloud Function): receives a POST from the Apps Script
  trigger, posts a formatted embed with **Create Event** / **Dismiss**
  buttons into your admin channel.
- **`interactions`** (Cloud Function): Discord's required Interactions
  Endpoint. Verifies the request is really from Discord, then on
  **Create Event** calls the Discord API to create a Guild Scheduled Event,
  edits the message to show the result, and posts an announcement to the
  public announcement channel.
- **`pollScheduledEvents`** (Cloud Function, run on a schedule): catches
  events created *directly* in Discord rather than through the bot — Discord
  only pushes event-creation notifications over a persistent Gateway
  connection, which doesn't fit a scale-to-zero serverless function, so
  instead this polls the guild's scheduled events every 5 minutes and
  announces anything new. A Firestore collection (`announcedEvents`,
  keyed by event ID) is shared with `interactions` so nothing gets
  announced twice regardless of which path created it.

## One-time setup

1. Complete the Discord Developer Portal steps (app, bot, permissions,
   public key, guild/channel IDs) — see the walkthrough you were given
   alongside this code. The bot's role needs **Manage Events** (guild-wide)
   and **View Channel + Send Messages** on both the admin channel and the
   public announcement channel.
2. `cp .env.yaml.example .env.yaml` and fill in the real values, including
   `DISCORD_ANNOUNCEMENT_CHANNEL_ID`.
3. Install deps: `npm install`
4. Enable the required GCP APIs and create the Firestore database (one-time,
   per project):
   ```
   gcloud services enable cloudfunctions.googleapis.com run.googleapis.com \
     cloudbuild.googleapis.com artifactregistry.googleapis.com \
     eventarc.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com
   gcloud firestore databases create --location=us-west1 --type=firestore-native
   ```
5. Deploy all three functions:
   ```
   npm run deploy:form-submit
   npm run deploy:interactions
   npm run deploy:poll-scheduled-events
   ```
   The first two print a **Trigger URL** — save both. `pollScheduledEvents`
   is deployed with `--no-allow-unauthenticated` since only Cloud Scheduler
   should be able to call it.
6. In the Discord Developer Portal, paste the `interactions` function's URL
   into **Interactions Endpoint URL** and save. Discord will immediately
   send a PING to verify it; if the deploy above succeeded this passes
   automatically.
7. In the Google Sheet collecting form responses: **Extensions > Apps
   Script**, paste in `appsscript/onFormSubmit.js`, update
   `FORM_SUBMIT_URL` (the `formSubmit` trigger URL from step 5) and
   `SHARED_SECRET` (must match `.env.yaml`'s `FORM_SHARED_SECRET`), then
   set the `COLUMNS` mapping to match your actual form's question order.
8. Add a trigger: clock icon on the left > **Add Trigger** > function
   `onFormSubmit` > event source **From spreadsheet** > event type
   **On form submit** > Save.
9. Wire up the poller's schedule and let it invoke itself via its own
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
   ```
   If you're adding this to a guild that already has scheduled events you
   don't want announced retroactively, seed Firestore's `announcedEvents`
   collection with their IDs before the first poll runs (see git history
   for the one-off backfill approach used here).

## Testing

Submit a test response through the actual Google Form (Apps Script
`onFormSubmit` triggers don't fire from manually editing the sheet). You
should see the embed appear in the admin channel within a few seconds.

## Notes / things you may want to tweak

- Events are created as `EXTERNAL` (physical location) rather than tied to
  a voice channel — change `entity_type` in `interactions.ts` if that's
  ever wrong for a meetup.
- The form now collects an explicit End Time, but `interactions.ts` still
  falls back to a 3-hour block if `endIso` is ever missing.
- If you ever want role-gating on who can click the buttons, the member's
  roles are available on `interaction.member.roles` inside the handler.
- Local testing: `npm run start:form-submit` or `npm run start:interactions`
  runs the Functions Framework locally; use a tool like `ngrok` to expose it
  if you need Discord to actually reach it during dev.
