import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import { hasBeenAnnounced, markAnnounced } from "./announced";
import { listGuildScheduledEvents, postChannelMessage } from "./discordApi";
import { formatEventWhen } from "./format";

const EVENT_STATUS_SCHEDULED = 1;

// Invoked on a schedule (Cloud Scheduler, every few minutes) rather than by
// Discord. Catches events created directly in Discord (not through the
// bot's Create Event button) by diffing the guild's scheduled events
// against what's already been announced. Events created via the button are
// marked announced immediately in interactions.ts, so this never
// double-posts those.
http("pollScheduledEvents", async (_req: Request, res: Response) => {
  const guildId = process.env.DISCORD_GUILD_ID;
  const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;

  if (!guildId || !announcementChannelId) {
    res.status(500).send("DISCORD_GUILD_ID / DISCORD_ANNOUNCEMENT_CHANNEL_ID not set");
    return;
  }

  const events = await listGuildScheduledEvents(guildId);
  const scheduled = events.filter((event) => event.status === EVENT_STATUS_SCHEDULED);

  let announced = 0;
  for (const event of scheduled) {
    try {
      if (await hasBeenAnnounced(event.id)) continue;

      await postChannelMessage(announcementChannelId, {
        embeds: [
          {
            title: `📅 New event: ${event.name}`,
            description: event.description || undefined,
            color: 0x2ecc71,
            url: `https://discord.com/events/${guildId}/${event.id}`,
            fields: [
              { name: "When", value: formatEventWhen(event.scheduled_start_time, event.scheduled_end_time), inline: true },
              ...(event.entity_metadata?.location ? [{ name: "Where", value: event.entity_metadata.location, inline: true }] : []),
            ],
          },
        ],
      });
      await markAnnounced(event.id);
      announced++;
    } catch (err) {
      // Leave this one unmarked so the next poll retries it.
      console.error(`Failed to announce event ${event.id}`, err);
    }
  }

  res.status(200).send(`checked ${scheduled.length}, announced ${announced}`);
});
