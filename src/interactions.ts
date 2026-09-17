import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import { verifyKey } from "discord-interactions";
import { editMessage } from "./discordApi";
import { buildRichDescription, resolveEndIso } from "./format";
import { createCalendarEvent } from "./googleCalendar";
import { StashedEventData } from "./types";

const InteractionType = { PING: 1, MESSAGE_COMPONENT: 3 };
const InteractionResponseType = {
  PONG: 1,
  DEFERRED_UPDATE_MESSAGE: 6,
};

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

    // Approving only adds the event to Google Calendar — Calendar is the
    // source of truth, so the Discord Scheduled Event and the #events
    // announcement are created automatically by pollScheduledEvents.ts once
    // it picks up this new Calendar event (within a few minutes).
    if (customId === "create_event" && stashed) {
      const richDescription = buildRichDescription(stashed.description, stashed.eventType, stashed.arrivalIso);
      const endIso = resolveEndIso(stashed.startIso, stashed.endIso);

      await createCalendarEvent({
        title: stashed.title,
        description: richDescription,
        startIso: stashed.startIso,
        endIso,
        location: stashed.location,
      });

      await editMessage(channelId, messageId, {
        embeds: [
          {
            ...embed,
            color: 0x2ecc71,
            title: `✅ Approved — added to Calendar: ${embed.title?.replace(/^New event request: /, "")}`,
          },
        ],
        components: [],
      });
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
