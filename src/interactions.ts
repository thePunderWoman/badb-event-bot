import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import { verifyKey } from "discord-interactions";
import { markAnnounced } from "./announced";
import { createGuildScheduledEvent, editMessage, postChannelMessage } from "./discordApi";
import { formatEventWhen, formatTime } from "./format";
import { StashedEventData } from "./types";

const InteractionType = { PING: 1, MESSAGE_COMPONENT: 3 };
const InteractionResponseType = {
  PONG: 1,
  DEFERRED_UPDATE_MESSAGE: 6,
};

// GUILD_SCHEDULED_EVENT_ENTITY_TYPE.EXTERNAL — since droid meetups happen at
// physical venues rather than in a Discord voice channel.
const ENTITY_TYPE_EXTERNAL = 3;
const EVENT_STATUS_SCHEDULED = 1;
const PRIVACY_LEVEL_GUILD_ONLY = 2;

function parseStash(footerText: string | undefined): StashedEventData | null {
  if (!footerText) return null;
  try {
    return JSON.parse(footerText);
  } catch {
    return null;
  }
}

http("interactions", async (req: Request, res: Response) => {
  const signature = req.header("x-signature-ed25519");
  const timestamp = req.header("x-signature-timestamp");
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) {
    res.status(401).send("Missing signature");
    return;
  }

  // req.rawBody is provided by the Cloud Functions/functions-framework
  // runtime — required here since signature verification is over the exact
  // raw bytes, not the re-serialized JSON.
  const rawBody: Buffer = (req as any).rawBody;
  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    res.status(401).send("Bad signature");
    return;
  }

  const interaction = req.body;

  if (interaction.type === InteractionType.PING) {
    res.status(200).json({ type: InteractionResponseType.PONG });
    return;
  }

  if (interaction.type !== InteractionType.MESSAGE_COMPONENT) {
    res.status(400).send("Unsupported interaction type");
    return;
  }

  // Ack immediately (Discord requires a response within 3s); we do the
  // real work after and patch the message in as a follow-up.
  res.status(200).json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });

  const channelId = interaction.channel_id ?? interaction.channel?.id;
  const messageId = interaction.message?.id;
  const embed = interaction.message?.embeds?.[0];
  const stashed = parseStash(embed?.footer?.text);
  const customId = interaction.data?.custom_id;

  if (!channelId || !messageId || !embed) return;

  try {
    if (customId === "dismiss") {
      await editMessage(channelId, messageId, {
        embeds: [{ ...embed, color: 0x555555, title: `❌ Dismissed — ${embed.title?.replace(/^New event request: /, "")}` }],
        components: [],
      });
      return;
    }

    if (customId === "create_event" && stashed) {
      const guildId = process.env.DISCORD_GUILD_ID;
      if (!guildId) throw new Error("DISCORD_GUILD_ID is not set");

      // Discord's Scheduled Event has no dedicated "arrival time" or "type"
      // fields, so fold them into the description text instead.
      const arrivalNote = stashed.arrivalIso ? `Arrival: ${formatTime(stashed.arrivalIso)}\n\n` : "";
      const typeNote = stashed.eventType ? `Type: ${stashed.eventType}\n\n` : "";

      const scheduledEvent = await createGuildScheduledEvent(guildId, {
        name: stashed.title,
        privacy_level: PRIVACY_LEVEL_GUILD_ONLY,
        scheduled_start_time: stashed.startIso,
        scheduled_end_time: stashed.endIso ?? new Date(new Date(stashed.startIso).getTime() + 3 * 60 * 60 * 1000).toISOString(),
        description: `${typeNote}${arrivalNote}${stashed.description}`,
        entity_type: ENTITY_TYPE_EXTERNAL,
        entity_metadata: { location: stashed.location },
        status: EVENT_STATUS_SCHEDULED,
      });

      const eventUrl = `https://discord.com/events/${guildId}/${scheduledEvent.id}`;

      await editMessage(channelId, messageId, {
        embeds: [
          {
            ...embed,
            color: 0x2ecc71,
            title: `✅ Event created — ${embed.title?.replace(/^New event request: /, "")}`,
            url: eventUrl,
          },
        ],
        components: [],
      });

      // Best-effort public announcement — the event itself is already
      // created at this point, so a failure here shouldn't be reported as
      // an "Action failed" on the admin message.
      const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
      if (announcementChannelId) {
        try {
          await postChannelMessage(announcementChannelId, {
            embeds: [
              {
                title: `📅 New event: ${stashed.title}`,
                description: stashed.description || undefined,
                color: 0x2ecc71,
                url: eventUrl,
                fields: [
                  { name: "Type", value: stashed.eventType, inline: true },
                  { name: "When", value: formatEventWhen(stashed.startIso, stashed.endIso), inline: true },
                  { name: "Where", value: stashed.location, inline: true },
                  ...(stashed.arrivalIso ? [{ name: "Arrival", value: formatTime(stashed.arrivalIso), inline: true }] : []),
                ],
              },
            ],
          });
          await markAnnounced(scheduledEvent.id);
        } catch (err) {
          console.error("Failed to post announcement", err);
        }
      }
    }
  } catch (err) {
    console.error(err);
    // Best-effort: leave a note on the message rather than failing silently.
    try {
      await editMessage(channelId, messageId, {
        embeds: [{ ...embed, color: 0xe74c3c, title: `⚠️ Action failed — ${embed.title}` }],
      });
    } catch {
      /* nothing more we can do */
    }
  }
});
