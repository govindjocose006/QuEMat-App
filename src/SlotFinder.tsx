import { useEffect, useState } from "react";
import { freeStarts } from "../shared/free-slots.js";
import type { Instrument } from "../shared/schema.js";
import type { Booking, Availability } from "../shared/scheduling.js";
import { fromIST, istInput } from "../shared/scheduling-ui.js";
import { api } from "./api.js";
import { ErrorNotice, messageOf } from "./components.js";

export type Slot = { instrumentId: string; startsAt: string; endsAt: string };
const minute = 60000;
const local = (n: number) => istInput(new Date(n).toISOString());
export function SlotFinder({
  items,
  initialInstrumentId,
  initialDate,
  choose,
}: {
  items: Instrument[];
  initialInstrumentId: string;
  initialDate: string;
  choose: (slot: Slot) => void;
}) {
  const today = local(Date.now()).slice(0, 10);
  const [id, setId] = useState(
    items.find((i) => i.id === initialInstrumentId)?.id ?? items[0]?.id ?? "",
  );
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const [minutes, setMinutes] = useState("60");
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    bookings: Booking[];
    windows: Availability[];
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [selected, setSelected] = useState("");
  const resource = items.find((i) => i.id === id);
  const duration = Number(minutes);
  const day = Date.parse(date + "T00:00:00+05:30");
  const valid =
    !!resource &&
    Number.isFinite(day) &&
    date.length === 10 &&
    date >= today &&
    Number.isInteger(duration) &&
    duration > 0 &&
    duration <= 90 * 1440;
  const from = day - (resource?.setupMinutes ?? 0) * minute;
  const to = day + (1440 + duration + (resource?.cleanupMinutes ?? 0)) * minute;
  const key = [id, from, to, attempt].join("/");
  useEffect(() => {
    if (!valid) return;
    let live = true;
    const params = new URLSearchParams({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    void Promise.all([
      api<Booking[]>("/bookings?" + params),
      api<Availability[]>("/availability"),
    ])
      .then(([bookings, windows]) => {
        if (live) {
          setResult({ key, bookings, windows });
          setFailure(null);
        }
      })
      .catch((e) => {
        if (live) setFailure({ key, message: messageOf(e) });
      });
    return () => {
      live = false;
    };
  }, [from, to, key, valid]);
  const gaps =
    valid && resource && result?.key === key
      ? freeStarts(
          resource,
          day,
          duration,
          result.bookings,
          result.windows,
          Date.now(),
        )
      : [];
  const start = selected ? Date.parse(fromIST(date + "T" + selected)) : NaN;
  const selectable = gaps.some((g) => start >= g.start && start <= g.end);
  return (
    <div className="dialog-body slot-finder">
      <div className="form-grid">
        <label>
          Instrument
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setSelected("");
            }}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start date (IST)
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => {
              setDate(e.target.value);
              setSelected("");
            }}
          />
        </label>
        <label>
          Duration (minutes)
          <input
            type="number"
            value={minutes}
            min="1"
            max={90 * 1440}
            onChange={(e) => {
              setMinutes(e.target.value);
              setSelected("");
            }}
          />
        </label>
      </div>
      {!valid ? (
        <p role="status">
          {items.length
            ? "Choose today or a later date and a duration of 1 minute to 90 days."
            : "No instruments are available for booking."}
        </p>
      ) : failure?.key === key ? (
        <>
          <ErrorNotice message={failure.message} />
          <button className="secondary" onClick={() => retry((a) => a + 1)}>
            Retry availability
          </button>
        </>
      ) : result?.key !== key ? (
        <p role="status">Checking the calendar…</p>
      ) : gaps.length ? (
        <>
          <p>
            Choose a start time within any range below. Setup and cleanup are
            included in the availability check.
          </p>
          <div className="action-row">
            {gaps.map((g) => (
              <button
                key={g.start}
                className="secondary"
                onClick={() => setSelected(local(g.start).slice(11))}
              >
                {local(g.start).slice(11)}
                {g.end > g.start && " – " + local(g.end).slice(11)}
              </button>
            ))}
          </div>
          <label>
            Preferred start (IST)
            <input
              type="time"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            />
          </label>
          {selected && !selectable && (
            <p role="status">Choose a time within an available range.</p>
          )}
          <button
            className="primary"
            disabled={!selectable}
            onClick={() =>
              choose({
                instrumentId: id,
                startsAt: local(start),
                endsAt: local(start + duration * minute),
              })
            }
          >
            Use this time
          </button>
        </>
      ) : (
        <p role="status">
          {result.bookings.some(
            (b) =>
              b.instrumentId === id &&
              b.status === "in_progress" &&
              Date.parse(b.endsAt) <= Date.now() &&
              !(b.overrunUntil && Date.parse(b.overrunUntil) > Date.now()),
          )
            ? "The current run is overdue. Available times can be shown once the operator records an estimated end or completes the run."
            : "No start times fit this duration. Try another date or a shorter run."}
        </p>
      )}
    </div>
  );
}
