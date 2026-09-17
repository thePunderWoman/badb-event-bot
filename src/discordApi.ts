const API_BASE = "https://discord.com/api/v10";

function botHeaders(): Record<string, string> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set");
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function discordFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord API ${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res;
}

export async function postChannelMessage(channelId: string, body: unknown): Promise<any> {
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    headers: botHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function createGuildScheduledEvent(guildId: string, body: unknown): Promise<any> {
  const res = await discordFetch(`/guilds/${guildId}/scheduled-events`, {
    method: "POST",
    headers: botHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function updateGuildScheduledEvent(guildId: string, eventId: string, body: unknown): Promise<any> {
  const res = await discordFetch(`/guilds/${guildId}/scheduled-events/${eventId}`, {
    method: "PATCH",
    headers: botHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// Edits the message that a component interaction came from, using the
// interaction's own webhook (no separate bot-token call needed here, but
// bot token auth works too and is simpler to reason about, so we use it).
export async function editMessage(channelId: string, messageId: string, body: unknown): Promise<any> {
  const res = await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: botHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}
