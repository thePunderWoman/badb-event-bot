# BADB Event Bot

Google Form submission → Discord admin channel notification → one-click
Discord Scheduled Event creation. No database — the event data lives in the
Discord message itself (JSON tucked into the embed footer) and is parsed
back out when a button is clicked.

## Architecture

- **`formSubmit`** (Cloud Function): receives a POST from the Apps Script
  trigger, posts a formatted embed with **Create Event** / **Dismiss**
  buttons into your admin channel.
- **`interactions`** (Cloud Function): Discord's required Interactions
  Endpoint. Verifies the request is really from Discord, then on
  **Create Event** calls the Discord API to create a Guild Scheduled Event
  and edits the message to show the result.

## One-time setup

1. Complete the Discord Developer Portal steps (app, bot, permissions,
   public key, guild/channel IDs) — see the walkthrough you were given
   alongside this code.
2. `cp .env.yaml.example .env.yaml` and fill in the real values.
3. Install deps: `npm install`
4. Deploy both functions:
   ```
   npm run deploy:form-submit
   npm run deploy:interactions
   ```
   Each command prints a **Trigger URL** — save both.
5. In the Discord Developer Portal, paste the `interactions` function's URL
   into **Interactions Endpoint URL** and save. Discord will immediately
   send a PING to verify it; if the deploy above succeeded this passes
   automatically.
6. In the Google Sheet collecting form responses: **Extensions > Apps
   Script**, paste in `appsscript/onFormSubmit.js`, update
   `FORM_SUBMIT_URL` (the `formSubmit` trigger URL from step 4) and
   `SHARED_SECRET` (must match `.env.yaml`'s `FORM_SHARED_SECRET`), then
   set the `COLUMNS` mapping to match your actual form's question order.
7. Add a trigger: clock icon on the left > **Add Trigger** > function
   `onFormSubmit` > event source **From spreadsheet** > event type
   **On form submit** > Save.

## Testing

Submit a test response through the actual Google Form (Apps Script
`onFormSubmit` triggers don't fire from manually editing the sheet). You
should see the embed appear in the admin channel within a few seconds.

## Notes / things you may want to tweak

- Events are created as `EXTERNAL` (physical location) rather than tied to
  a voice channel — change `entity_type` in `interactions.ts` if that's
  ever wrong for a meetup.
- No end time on the form? We default to a 3-hour block. Adjust the
  fallback in `interactions.ts` if your events usually run longer/shorter.
- If you ever want role-gating on who can click the buttons, the member's
  roles are available on `interaction.member.roles` inside the handler.
- Local testing: `npm run start:form-submit` or `npm run start:interactions`
  runs the Functions Framework locally; use a tool like `ngrok` to expose it
  if you need Discord to actually reach it during dev.
