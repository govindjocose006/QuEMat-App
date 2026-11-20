import { expect, test } from "vitest";
import { freeStarts } from "../shared/free-slots.js";
import type { Booking, Availability } from "../shared/scheduling.js";

const day = Date.parse("2037-01-02T00:00:00+05:30");
const at = (min: number) => day + min * 60000;
const iso = (min: number) => new Date(at(min)).toISOString();
const resource = {
  id: "ppms",
  schedulingMode: "internal" as const,
  setupMinutes: 10,
  cleanupMinutes: 5,
};
const window = (start: number, end: number): Availability => ({
  id: "w",
  instrumentId: resource.id,
  reference: "",
  startsAt: iso(start),
  endsAt: iso(end),
});
const busy = (start: number, end: number, overrides: Partial<Booking> = {}) =>
  ({
    instrumentId: resource.id,
    reservedStart: iso(start),
    reservedEnd: iso(end),
    endsAt: iso(end),
    status: "confirmed",
    cleanupMinutes: 0,
    ...overrides,
  }) as Booking;
test("adjacent bookings fit with buffers, independently of other instruments and cancelled slots", () => {
  const blocks = [
    busy(60, 120),
    busy(150, 240, { instrumentId: "xrd" }),
    busy(150, 240, { status: "cancelled" }),
  ];
  expect(freeStarts(resource, day, 30, blocks, [], at(-60))).toEqual([
    { start: at(0), end: at(25) },
    { start: at(130), end: at(1439) },
  ]);
});
test("setup and cleanup fit one allocation, even across midnight", () => {
  const allocated = { ...resource, schedulingMode: "allocated" as const };
  expect(
    freeStarts(
      allocated,
      day,
      60,
      [],
      [window(1320, 1370), window(1370, 1450)],
      at(-60),
    ),
  ).toEqual([{ start: at(1380), end: at(1385) }]);
  expect(freeStarts(allocated, day, 60, [], [], at(-60))).toEqual([]);
});
test("cleanup after a late finish and estimated or unknown overruns affect available starts", () => {
  const ended = busy(0, 60, {
    status: "completed",
    actualEnd: iso(65),
    cleanupMinutes: 15,
  });
  expect(freeStarts(resource, day, 30, [ended], [], at(70))[0].start).toBe(
    at(90),
  );
  const running = busy(0, 60, { status: "in_progress", cleanupMinutes: 15 });
  expect(freeStarts(resource, day, 30, [running], [], at(70))).toEqual([]);
  expect(
    freeStarts(
      resource,
      day,
      30,
      [{ ...running, overrunUntil: iso(120) }],
      [],
      at(70),
    )[0].start,
  ).toBe(at(145));
});
