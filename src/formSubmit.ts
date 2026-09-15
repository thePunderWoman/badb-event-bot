import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";
import { postChannelMessage } from "./discordApi";
import { formatEventWhen, formatTime } from "./format";
import { EventRequestPayload, StashedEventData } from "./types";

function isValidPayload(body: any): body is EventRequestPayload {
  return (
    body &&
    typeof body.title === "string" &&
    typeof body.eventType === "string" &&
    typeof body.startIso === "string" &&
    typeof body.location === "string" &&
    typeof body.description === "string" &&
    typeof body.requesterName === "string"
  );
}

http("formSubmit", async (req: Request, res: Response) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const sharedSecret = process.env.FORM_SHARED_SECRET;
  if (sharedSecret && req.header("x-form-secret") !== sharedSecret) {
    res.status(401).send("Unauthorized");
    return;
  }

  const payload = req.body;
  if (!isValidPayload(payload)) {
    res.status(400).send("Missing required fields (title, eventType, startIso, location, description, requesterName)");
    return;
  }

  const channelId = process.env.DISCORD_ADMIN_CHANNEL_ID;
  if (!channelId) {
    res.status(500).send("DISCORD_ADMIN_CHANNEL_ID is not set");
    return;
  }

  const stashed: StashedEventData = { v: 1, ...payload };

  const embed = {
    title: `New event request: ${payload.title}`,
    color: 0x8a2be2, // dark purple, because of course
    fields: [
      { name: "Type", value: payload.eventType, inline: true },
      { name: "When", value: formatEventWhen(payload.startIso, payload.endIso), inline: true },
      { name: "Where", value: payload.location, inline: true },
      ...(payload.arrivalIso ? [{ name: "Arrival", value: formatTime(payload.arrivalIso), inline: true }] : []),
      { name: "Requested by", value: payload.requesterName, inline: true },
      { name: "Details", value: payload.description || "(none provided)" },
    ],
    // Compact JSON of the raw payload, tucked in the footer so the
    // interactions handler can reconstruct it without a database.
    footer: { text: JSON.stringify(stashed) },
    url: payload.formResponseUrl,
  };

  try {
    await postChannelMessage(channelId, {
      embeds: [embed],
      components: [
        {
          type: 1, // action row
          components: [
            {
              type: 2, // button
              style: 3, // green
              label: "Create Event",
              custom_id: "create_event",
            },
            {
              type: 2,
              style: 4, // red
              label: "Dismiss",
              custom_id: "dismiss",
            },
          ],
        },
      ],
    });
    res.status(200).send("posted");
  } catch (err) {
    console.error(err);
    res.status(502).send("Failed to post to Discord");
  }
});
