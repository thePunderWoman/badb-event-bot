import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunction } from "@google-cloud/functions-framework/testing";

const steps: string[] = [];

vi.mock("../src/eventSync", () => ({
  acquirePollLock: vi.fn(async () => "lock-token"),
  releasePollLock: vi.fn(async () => void steps.push("releasePollLock")),
  getSyncToken: vi.fn(async () => "sync-token"),
  saveSyncToken: vi.fn(async () => {}),
  getEventMapping: vi.fn(async () => undefined),
  saveEventMapping: vi.fn(async () => {}),
}));
vi.mock("../src/googleCalendar", () => ({ listCalendarChanges: vi.fn() }));
vi.mock("../src/discordApi", () => ({
  createGuildScheduledEvent: vi.fn(async () => ({ id: "discord-event" })),
  updateGuildScheduledEvent: vi.fn(async () => ({})),
  postChannelMessage: vi.fn(async () => ({})),
}));

import "../src/pollScheduledEvents";
import { createGuildScheduledEvent, postChannelMessage } from "../src/discordApi";
import { acquirePollLock, releasePollLock } from "../src/eventSync";
import { listCalendarChanges } from "../src/googleCalendar";

const handler = getFunction("pollScheduledEvents") as (req: any, res: any) => Promise<void>;

function fakeResponse() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => {
    steps.push("respond");
    return res;
  });
  return res;
}

const allDayEvent = {
  id: "cal-1",
  status: "confirmed",
  summary: "Droid Day",
  start: { date: "2026-10-25" },
  end: { date: "2026-10-26" }, // Calendar's exclusive end: a one-day event
};

describe("pollScheduledEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    steps.length = 0;
    process.env.DISCORD_GUILD_ID = "guild";
    process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = "events";
    process.env.GOOGLE_CALENDAR_ID = "cal@example.com";
    vi.mocked(listCalendarChanges).mockResolvedValue({ events: [allDayEvent], nextSyncToken: "next" });
  });

  it("skips entirely while another run holds the lock", async () => {
    vi.mocked(acquirePollLock).mockResolvedValueOnce(undefined);
    const res = fakeResponse();

    await handler({}, res);

    expect(listCalendarChanges).not.toHaveBeenCalled();
    expect(createGuildScheduledEvent).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith("skipped — another poll run is in progress");
  });

  it("mirrors a new event, then releases the lock before responding", async () => {
    const res = fakeResponse();

    await handler({}, res);

    expect(createGuildScheduledEvent).toHaveBeenCalledTimes(1);
    expect(releasePollLock).toHaveBeenCalledWith("lock-token");
    expect(steps).toEqual(["releasePollLock", "respond"]);
    expect(res.send).toHaveBeenCalledWith("checked 1, created 1, updated 0, cancelled 0");
  });

  it("announces a one-day all-day event as that single day", async () => {
    await handler({}, fakeResponse());

    const embed = vi.mocked(postChannelMessage).mock.calls[0][1] as any;
    expect(embed.embeds[0].fields[0]).toEqual({ name: "When", value: "Oct 25, 2026", inline: true });
  });

  it("releases the lock even when the sync fails", async () => {
    vi.mocked(listCalendarChanges).mockRejectedValueOnce(new Error("Calendar is down"));

    await expect(handler({}, fakeResponse())).rejects.toThrow("Calendar is down");
    expect(releasePollLock).toHaveBeenCalledWith("lock-token");
  });
});
