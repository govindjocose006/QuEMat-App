import { describe, it, expect } from "vitest";
import {
  bookingDuration,
  notificationMessage,
  labDate,
  bookingDaySegment,
} from "../src/ui-format.js";
describe("booking duration", () => {
  it("shows overnight and multi-day reserved time in the lab timezone", () => {
    expect(bookingDuration("2026-11-01T23:30", "2026-11-02T01:00")).toContain(
      "1 h 30 min",
    );
    expect(bookingDuration("2026-11-01T12:00", "2026-11-03T12:00")).toContain(
      "48 h",
    );
    expect(bookingDuration("2026-11-01T12:00", "2026-11-01T12:15")).toContain(
      "15 min",
    );
  });
  it("handles incomplete and reversed inputs without crashing", () => {
    expect(bookingDuration("", "")).toContain("Choose both times");
    expect(bookingDuration("bad", "bad")).toContain("valid");
    expect(bookingDuration("2026-11-01T12:00", "2026-11-01T12:00")).toBe(
      "End must be after start.",
    );
    expect(bookingDuration("2026-11-02T12:00", "2026-11-01T12:00")).toBe(
      "End must be after start.",
    );
  });
});
it("clarifies stored booking cancellations without changing other notification types", () => {
  expect(notificationMessage("PPMS: cancel. VSM.", true)).toBe(
    "PPMS: Booking cancelled. VSM.",
  );
  expect(notificationMessage("Issue: cancel. Proposed action.", false)).toBe(
    "Issue: cancel. Proposed action.",
  );
  expect(notificationMessage("PPMS: booking created. VSM.", true)).toBe(
    "PPMS: booking created. VSM.",
  );
});

describe("lab-day presentation", () => {
  it("makes date summaries unambiguous", () => {
    expect(labDate("2026-11-02")).toBe("2 Nov 2026");
    expect(labDate("")).toBe("Choose a date");
  });
  it("clips an overnight reservation to each IST day", () => {
    const start = "2026-11-02T18:00:00Z",
      end = "2026-11-02T19:30:00Z";
    expect(bookingDaySegment(start, end, "2026-11-02")).toEqual({
      from: 1410,
      to: 1440,
    });
    expect(bookingDaySegment(start, end, "2026-11-03")).toEqual({
      from: 0,
      to: 60,
    });
    expect(bookingDaySegment(start, end, "2026-11-04")).toBeNull();
  });
  it("excludes an exact-midnight end from the next day and rejects invalid intervals", () => {
    expect(
      bookingDaySegment(
        "2026-11-02T17:00:00Z",
        "2026-11-02T18:30:00Z",
        "2026-11-03",
      ),
    ).toBeNull();
    expect(bookingDaySegment("bad", "bad", "2026-11-02")).toBeNull();
    expect(
      bookingDaySegment(
        "2026-11-02T18:30:00Z",
        "2026-11-02T17:00:00Z",
        "2026-11-02",
      ),
    ).toBeNull();
  });
});
