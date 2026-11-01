import { describe, it, expect } from "vitest";
import { bookingDuration, notificationMessage } from "../src/ui-format.js";
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
