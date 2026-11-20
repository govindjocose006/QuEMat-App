import type { Instrument } from "./schema.js";
import type { Availability, Booking } from "./scheduling.js";

const minute = 60000;
type Interval = { start: number; end: number };
type Resource = Pick<
  Instrument,
  "id" | "schedulingMode" | "setupMinutes" | "cleanupMinutes"
>;

// Each result is an inclusive range of possible start times for the full run.
// Keep allocations separate until buffers and duration fit inside a single window.
export function freeStarts(
  resource: Resource,
  dayStart: number,
  durationMinutes: number,
  bookings: Booking[],
  allocations: Availability[],
  now: number,
): Interval[] {
  const dayEnd = dayStart + 1440 * minute;
  const setup = resource.setupMinutes * minute;
  const cleanup = resource.cleanupMinutes * minute;
  const duration = durationMinutes * minute;
  const lower = Math.max(dayStart, now + setup);
  const upper = dayEnd - minute;
  const occupied = bookings
    .filter(
      (b) =>
        b.instrumentId === resource.id &&
        b.status !== "cancelled" &&
        b.status !== "rejected",
    )
    .map((b) => ({
      start: Date.parse(b.reservedStart),
      end: Math.max(
        Date.parse(b.reservedEnd),
        b.actualEnd ? Date.parse(b.actualEnd) + b.cleanupMinutes * minute : 0,
        b.status === "in_progress" && b.overrunUntil
          ? Date.parse(b.overrunUntil) + b.cleanupMinutes * minute
          : 0,
        b.status === "in_progress" &&
          Date.parse(b.endsAt) <= now &&
          !(b.overrunUntil && Date.parse(b.overrunUntil) > now)
          ? Infinity
          : 0,
      ),
    }))
    .sort((a, b) => a.start - b.start);
  const windows =
    resource.schedulingMode === "allocated"
      ? allocations
          .filter((a) => a.instrumentId === resource.id)
          .map((a) => ({
            start: Date.parse(a.startsAt),
            end: Date.parse(a.endsAt),
          }))
      : [{ start: dayStart - setup, end: dayEnd + duration + cleanup }];
  const starts: Interval[] = [];
  function addGap(start: number, end: number) {
    const first = Math.ceil(Math.max(lower, start + setup) / minute) * minute;
    const last =
      Math.floor(Math.min(upper, end - cleanup - duration) / minute) * minute;
    if (first <= last) starts.push({ start: first, end: last });
  }
  for (const window of windows) {
    let cursor = window.start;
    for (const block of occupied) {
      if (block.start >= window.end) break;
      if (block.end <= cursor) continue;
      addGap(cursor, block.start);
      cursor = Math.max(cursor, block.end);
      if (cursor >= window.end) break;
    }
    addGap(cursor, window.end);
  }
  const merged: Interval[] = [];
  for (const gap of starts.sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && gap.start <= last.end + minute)
      last.end = Math.max(last.end, gap.end);
    else merged.push(gap);
  }
  return merged;
}
