import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
vi.mock("../src/googleAuth", () => ({
  getCalendarClient: async () => ({ events: { insert } }),
}));

import { createCalendarEvent } from "../src/googleCalendar";

const params = {
  id: "badb123456789012345678",
  title: "Droid Day",
  description: "Bring droids.",
  startIso: "2026-10-04T01:00:00.000Z",
  endIso: "2026-10-04T04:00:00.000Z",
  location: "The Park",
};

describe("createCalendarEvent", () => {
  beforeEach(() => {
    insert.mockReset();
    process.env.GOOGLE_CALENDAR_ID = "cal@example.com";
  });

  it("inserts the event under the caller-supplied ID", async () => {
    insert.mockResolvedValue({ data: { id: params.id } });

    await expect(createCalendarEvent(params)).resolves.toBe(params.id);
    expect(insert).toHaveBeenCalledWith({
      calendarId: "cal@example.com",
      requestBody: expect.objectContaining({ id: params.id, summary: "Droid Day" }),
    });
  });

  it("treats 409 Conflict (ID already exists) as already created", async () => {
    insert.mockRejectedValue(Object.assign(new Error("The requested identifier already exists."), { status: 409 }));

    await expect(createCalendarEvent(params)).resolves.toBe(params.id);
  });

  it("recognizes a 409 reported only on the response", async () => {
    insert.mockRejectedValue(Object.assign(new Error("conflict"), { response: { status: 409 } }));

    await expect(createCalendarEvent(params)).resolves.toBe(params.id);
  });

  it("rethrows other errors", async () => {
    insert.mockRejectedValue(Object.assign(new Error("backend error"), { status: 503 }));

    await expect(createCalendarEvent(params)).rejects.toThrow("backend error");
  });
});
