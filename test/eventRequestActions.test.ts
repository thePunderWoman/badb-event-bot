import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCalendarEvent } = vi.hoisted(() => ({ createCalendarEvent: vi.fn() }));
vi.mock("../src/googleCalendar", () => ({ createCalendarEvent }));

import { calendarEventIdForRequest, handleEventRequestAction } from "../src/eventRequestActions";

const MESSAGE_ID = "1290000000000000001";

const stash = {
  v: 1,
  title: "Droid Day",
  eventType: "Meetup",
  startIso: "2026-10-04T01:00:00.000Z",
  endIso: "2026-10-04T04:00:00.000Z",
  arrivalIso: "2026-10-04T00:00:00.000Z",
  location: "The Park",
  description: "Bring droids.",
  requesterName: "R2",
};

function requestEmbed(footer: string | undefined = JSON.stringify(stash)) {
  return { title: "New event request: Droid Day", color: 0x8a2be2, fields: [], footer: footer === undefined ? undefined : { text: footer } };
}

describe("calendarEventIdForRequest", () => {
  it("is stable for a message and uses only Calendar's allowed characters", () => {
    const id = calendarEventIdForRequest(MESSAGE_ID);
    expect(id).toBe(calendarEventIdForRequest(MESSAGE_ID));
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe("handleEventRequestAction", () => {
  beforeEach(() => {
    createCalendarEvent.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("approves by creating the Calendar event under the request's stable ID", async () => {
    createCalendarEvent.mockResolvedValue("ignored");

    const edit = await handleEventRequestAction("create_event", MESSAGE_ID, requestEmbed());

    expect(createCalendarEvent).toHaveBeenCalledWith({
      id: calendarEventIdForRequest(MESSAGE_ID),
      title: "Droid Day",
      description: "Type: Meetup\n\nArrival: 5:00 PM\n\nBring droids.",
      startIso: stash.startIso,
      endIso: stash.endIso,
      location: "The Park",
    });
    expect(edit?.embeds[0].title).toBe("✅ Approved — added to Calendar: Droid Day");
    expect(edit?.components).toEqual([]);
  });

  it("uses the same Calendar event ID when Approve is clicked twice", async () => {
    createCalendarEvent.mockResolvedValue("ignored");

    await handleEventRequestAction("create_event", MESSAGE_ID, requestEmbed());
    await handleEventRequestAction("create_event", MESSAGE_ID, requestEmbed());

    const ids = createCalendarEvent.mock.calls.map(([p]) => p.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("reports a failure, keeping the buttons so it can be retried", async () => {
    createCalendarEvent.mockRejectedValue(new Error("Calendar is down"));

    const edit = await handleEventRequestAction("create_event", MESSAGE_ID, requestEmbed());

    expect(edit?.embeds[0].title).toBe("⚠️ Not added to Calendar — Droid Day");
    expect(edit?.embeds[0].description).toContain("Calendar is down");
    expect(edit?.embeds[0].description).toContain("won't create a duplicate");
    expect(edit).not.toHaveProperty("components");
  });

  it("clears the failure note once a retry succeeds", async () => {
    createCalendarEvent.mockResolvedValue("ignored");
    const failedEmbed = { ...requestEmbed(), title: "⚠️ Not added to Calendar — Droid Day", description: "Couldn't add this…" };

    const edit = await handleEventRequestAction("create_event", MESSAGE_ID, failedEmbed);

    expect(edit?.embeds[0].title).toBe("✅ Approved — added to Calendar: Droid Day");
    expect(JSON.parse(JSON.stringify(edit)).embeds[0]).not.toHaveProperty("description");
  });

  it("reports unreadable event details without touching Calendar", async () => {
    const edit = await handleEventRequestAction("create_event", MESSAGE_ID, requestEmbed("not json"));

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(edit?.embeds[0].title).toBe("⚠️ Not added to Calendar — Droid Day");
  });

  it("dismisses without touching Calendar", async () => {
    const edit = await handleEventRequestAction("dismiss", MESSAGE_ID, requestEmbed());

    expect(createCalendarEvent).not.toHaveBeenCalled();
    expect(edit?.embeds[0].title).toBe("❌ Dismissed — Droid Day");
    expect(edit?.components).toEqual([]);
  });

  it("ignores buttons it doesn't know", async () => {
    await expect(handleEventRequestAction("something_else", MESSAGE_ID, requestEmbed())).resolves.toBeNull();
  });
});
