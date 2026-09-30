import { describe, expect, it } from "vitest";
import { buildRichDescription, formatCalendarEventWhen, formatEventWhen, formatTime } from "../src/format";

// The Apps Script trigger sends UTC instants (Date#toISOString), so a 6 PM
// PDT start arrives as 01:00Z the next day.
const START_6PM_PDT = "2026-10-04T01:00:00.000Z";
const END_9PM_PDT = "2026-10-04T04:00:00.000Z";
const ARRIVAL_5PM_PDT = "2026-10-04T00:00:00.000Z";

describe("formatEventWhen", () => {
  it("shows times in Pacific, not the server's UTC", () => {
    expect(formatEventWhen(START_6PM_PDT, END_9PM_PDT)).toBe("Oct 3, 2026, 6:00 PM – Oct 3, 2026, 9:00 PM");
  });

  it("follows daylight saving time", () => {
    expect(formatEventWhen("2026-12-05T02:00:00.000Z")).toBe("Dec 4, 2026, 6:00 PM");
  });

  it("formats all-day (date-only) values as the date itself", () => {
    expect(formatEventWhen("2026-10-25", "2026-10-27")).toBe("Oct 25, 2026 – Oct 27, 2026");
  });
});

describe("formatCalendarEventWhen", () => {
  it("shows a multi-day all-day event ending on its last real day, not Calendar's exclusive end", () => {
    // Oct 25–27 is stored by Calendar with end.date = Oct 28.
    expect(formatCalendarEventWhen("2026-10-25", "2026-10-28")).toBe("Oct 25, 2026 – Oct 27, 2026");
  });

  it("shows a single-day all-day event as just its date", () => {
    expect(formatCalendarEventWhen("2026-10-25", "2026-10-26")).toBe("Oct 25, 2026");
  });

  it("handles an all-day event ending across a month boundary", () => {
    expect(formatCalendarEventWhen("2026-10-30", "2026-11-01")).toBe("Oct 30, 2026 – Oct 31, 2026");
  });

  it("leaves timed events unchanged", () => {
    expect(formatCalendarEventWhen(START_6PM_PDT, END_9PM_PDT)).toBe("Oct 3, 2026, 6:00 PM – Oct 3, 2026, 9:00 PM");
  });
});

describe("formatTime", () => {
  it("shows the time in Pacific", () => {
    expect(formatTime(ARRIVAL_5PM_PDT)).toBe("5:00 PM");
  });
});

describe("buildRichDescription", () => {
  it("writes the arrival time in Pacific", () => {
    expect(buildRichDescription("Bring droids.", "Meetup", ARRIVAL_5PM_PDT)).toBe("Type: Meetup\n\nArrival: 5:00 PM\n\nBring droids.");
  });
});
