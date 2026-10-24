import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Instrument, Member } from "../shared/schema.js";
import type {
  Sample,
  Booking,
  Operator,
  Availability,
  Notification,
} from "../shared/scheduling.js";
import {
  managesOperations,
  istInput,
  fromIST,
} from "../shared/scheduling-ui.js";
import { api } from "./api.js";
import {
  ErrorNotice,
  Modal,
  Status,
  formatDate,
  messageOf,
} from "./components.js";

const day = (value = new Date().toISOString()) => istInput(value).slice(0, 10);
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const rangeQuery = (from: string, to: string) =>
  `?from=${encodeURIComponent(fromIST(from + "T00:00"))}&to=${encodeURIComponent(fromIST(to + "T00:00"))}`;
const active = (b: Booking) =>
  ["requested", "confirmed", "in_progress"].includes(b.status);
const field = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={type === "number" ? "any" : undefined}
      />
    </label>
  );
}
function Notes({
  label,
  name,
  value = "",
}: {
  label: string;
  name: string;
  value?: string;
}) {
  return (
    <label className="full">
      {label}
      <textarea name={name} defaultValue={value} maxLength={2000} />
    </label>
  );
}
function SampleForm({
  sample,
  onSaved,
}: {
  sample?: Sample;
  onSaved: (s: Sample) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const data = {
        ...Object.fromEntries(f),
        preparedOn: field(f, "preparedOn") || null,
        archived: f.has("archived"),
        ...(sample ? { version: sample.version } : {}),
      };
      onSaved(
        await api<Sample>(
          sample ? `/samples/${sample.id}` : "/samples",
          sample ? "PUT" : "POST",
          data,
        ),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <ErrorNotice message={error} />
      <div className="form-grid">
        <Field
          label="Compound / formula"
          name="compound"
          value={sample?.compound}
          required
        />
        <Field label="Project" name="project" value={sample?.project} />
        <Field label="Batch" name="batch" value={sample?.batch} />
        <Field
          label="Preparation date"
          name="preparedOn"
          type="date"
          value={sample?.preparedOn ?? ""}
        />
        <label>
          Origin
          <select name="origin" defaultValue={sample?.origin ?? "internal"}>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </label>
        <Field
          label="Physical form"
          name="physicalForm"
          value={sample?.physicalForm}
        />
        <Field
          label="Quantity / mass (include units)"
          name="quantity"
          value={sample?.quantity}
        />
        <Field
          label="Storage location"
          name="storage"
          value={sample?.storage}
        />
        <Notes
          label="Notes and handling information"
          name="notes"
          value={sample?.notes}
        />
        {sample && (
          <label className="check-row">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={sample.archived}
            />
            Archive sample
          </label>
        )}
      </div>
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save sample"}
      </button>
    </form>
  );
}
export function Samples({ user }: { user: Member }) {
  const [items, setItems] = useState<Sample[]>([]),
    [search, setSearch] = useState(""),
    [sampleStatus, setSampleStatus] = useState<"active" | "archived" | "all">(
      "active",
    ),
    [editing, setEditing] = useState<Sample | null | undefined>(),
    [history, setHistory] = useState<Booking[] | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(
    () =>
      api<Sample[]>("/samples")
        .then(setItems)
        .catch((e) => setError(messageOf(e))),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const query = search.trim().toLowerCase();
  const visibleSamples = items.filter(
    (s) =>
      (sampleStatus === "all" ||
        s.archived === (sampleStatus === "archived")) &&
      JSON.stringify(s).toLowerCase().includes(query),
  );
  return (
    <section>
      <div className="section-title">
        <div>
          <h2>Shared sample register</h2>
          <p>Stable IDs connect batches, measurements, and result links.</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>
          New sample
        </button>
      </div>
      <ErrorNotice message={error} />
      <div className="schedule-controls">
        <label>
          Search samples
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ID, compound, batch, owner, project"
          />
        </label>
        <label>
          Sample status
          <select
            value={sampleStatus}
            onChange={(e) =>
              setSampleStatus(e.target.value as typeof sampleStatus)
            }
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="sample-grid">
        {visibleSamples.map((s) => (
          <article className="panel" key={s.id}>
            <span className="eyebrow">
              {s.code}
              {s.archived ? " · Archived" : ""}
            </span>
            <h3>{s.compound}</h3>
            <p>
              {s.ownerName} · {s.project || "No project"}
            </p>
            <dl>
              <dt>Batch / preparation</dt>
              <dd>
                {s.batch || "—"} / {s.preparedOn || "—"}
              </dd>
              <dt>Origin / form / quantity</dt>
              <dd>
                {s.origin} / {s.physicalForm || "—"} / {s.quantity || "—"}
              </dd>
              <dt>Storage</dt>
              <dd>{s.storage || "Not recorded"}</dd>
              <dt>Handling notes</dt>
              <dd>{s.notes || "Not recorded"}</dd>
            </dl>
            <div className="action-row">
              {(s.ownerId === user.id || managesOperations(user.appRole)) && (
                <button className="secondary" onClick={() => setEditing(s)}>
                  Edit {s.code}
                </button>
              )}
              <button
                className="secondary"
                onClick={() =>
                  void api<Booking[]>(`/samples/${s.id}/bookings`)
                    .then(setHistory)
                    .catch((e) => setError(messageOf(e)))
                }
              >
                History {s.code}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!visibleSamples.length && (
        <p role="status">
          {query
            ? "No samples match your search in this view."
            : sampleStatus === "active"
              ? "No active samples."
              : sampleStatus === "archived"
                ? "No archived samples."
                : "No samples registered yet."}
        </p>
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? `Edit ${editing.code}` : "New sample"}
          onClose={() => setEditing(undefined)}
        >
          <div className="dialog-body">
            <SampleForm
              sample={editing ?? undefined}
              onSaved={() => {
                setEditing(undefined);
                void reload();
              }}
            />
          </div>
        </Modal>
      )}
      {history && (
        <Modal
          title="Sample measurement history"
          onClose={() => setHistory(null)}
        >
          <div className="dialog-body">
            {history.length ? (
              history.map((b) => (
                <div className="panel" key={b.id}>
                  <BookingSummary b={b} />
                  <p>{b.completionSummary}</p>
                  <p>{b.handoverNotes}</p>
                  {b.dataLink && (
                    <a href={b.dataLink} target="_blank" rel="noreferrer">
                      Result data ↗
                    </a>
                  )}
                </div>
              ))
            ) : (
              <p>No linked measurements yet.</p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
export function BookingSummary({ b }: { b: Booking }) {
  return (
    <>
      <h3>
        {b.instrumentName} · {b.measurementType}
      </h3>
      <Status value={b.status.replaceAll("_", " ")} />
      <p>
        <strong>Operator:</strong> {b.operatorName}
      </p>
      <p>
        {b.sampleSnapshots.map((s) => `${s.code} · ${s.compound}`).join("; ") ||
          "Maintenance block"}
      </p>
      <p>
        {formatDate(b.startsAt)} → {formatDate(b.endsAt)}
      </p>
    </>
  );
}
function MeasurementFields({
  instrument,
  b,
}: {
  instrument?: Instrument;
  b?: Booking;
}) {
  const d = b?.details,
    magnetic = instrument?.category === "Magnetic & transport",
    furnace = instrument?.category === "Furnace",
    sputter = instrument?.name.toLowerCase().includes("sputter");
  return (
    <fieldset className="measurement-fields">
      <legend>
        {furnace
          ? "Furnace process"
          : sputter
            ? "Sputtering process"
            : magnetic
              ? "Magnetic / transport measurement"
              : "Measurement details"}
      </legend>
      <div className="form-grid">
        {magnetic && (
          <>
            <Field
              label="Temperature minimum"
              name="temperatureMin"
              type="number"
              value={d?.temperatureMin}
            />
            <Field
              label="Temperature maximum"
              name="temperatureMax"
              type="number"
              value={d?.temperatureMax}
            />
            <label>
              Temperature unit
              <select
                name="temperatureUnit"
                defaultValue={d?.temperatureUnit ?? "K"}
              >
                <option>K</option>
                <option>°C</option>
              </select>
            </label>
            <Field
              label="Field minimum"
              name="fieldMin"
              type="number"
              value={d?.fieldMin}
            />
            <Field
              label="Field maximum"
              name="fieldMax"
              type="number"
              value={d?.fieldMax}
            />
            <label>
              Field unit
              <select name="fieldUnit" defaultValue={d?.fieldUnit ?? "T"}>
                <option>T</option>
                <option>Oe</option>
              </select>
            </label>
            <Field
              label="Sequence (M(T), M(H), ZFC/FC, relaxation, custom)"
              name="sequence"
              value={d?.sequence}
            />
            <Field
              label="Sample mass (include units)"
              name="sampleMass"
              value={d?.sampleMass}
            />
            <Notes label="Mounting notes" name="mounting" value={d?.mounting} />
            <Notes
              label="Required accessories / configuration"
              name="accessories"
              value={d?.accessories}
            />
          </>
        )}
        {furnace && (
          <>
            <Field
              label={`Target temperature °C (maximum ${instrument?.maxTemperatureC ?? "not configured"})`}
              name="targetTemperatureC"
              type="number"
              value={d?.targetTemperatureC}
              required
            />
            <Field label="Atmosphere" name="atmosphere" value={d?.atmosphere} />
            <Notes
              label="Ramp / hold / cooling stages"
              name="stages"
              value={d?.stages}
            />
            <Notes label="Crucible notes" name="crucible" value={d?.crucible} />
            <p className="full notice">
              Reserve the entire occupancy, including cooling. Completion and
              unloading must be confirmed explicitly.
            </p>
          </>
        )}
        {sputter && (
          <>
            <Field
              label="Target material"
              name="targetMaterial"
              value={d?.targetMaterial}
              required
            />
            <Field
              label="Substrate"
              name="substrate"
              value={d?.substrate}
              required
            />
            <label>
              Mode
              <select name="mode" defaultValue={d?.mode ?? "RF"}>
                <option>RF</option>
                <option>DC</option>
                <option value="other">Other</option>
              </select>
            </label>
            <Field label="Gas" name="gas" value={d?.gas} />
            {(["pressure", "power", "duration", "thickness"] as const).map(
              (k) => (
                <Field
                  key={k}
                  label={`${k[0].toUpperCase() + k.slice(1)} (include units)`}
                  name={k}
                  value={d?.[k]}
                />
              ),
            )}
            <Notes
              label="Preparation notes"
              name="preparation"
              value={d?.preparation}
            />
            <Notes label="Cleaning plan" name="cleaning" value={d?.cleaning} />
          </>
        )}
        <Notes
          label="Setup requirements and notes"
          name="setupNotes"
          value={b?.setupNotes}
        />
      </div>
    </fieldset>
  );
}
function BookingForm({
  user,
  items,
  b,
  onSaved,
}: {
  user: Member;
  items: Instrument[];
  b?: Booking;
  onSaved: () => void;
}) {
  const [instrumentId, setInstrumentId] = useState(
      b?.instrumentId ?? items[0]?.id ?? "",
    ),
    [samples, setSamples] = useState<Sample[]>([]),
    [operators, setOperators] = useState<Operator[]>([]),
    [selected, setSelected] = useState<string[]>(
      b?.sampleSnapshots.map((s) => s.id) ?? [],
    ),
    [quick, setQuick] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const instrument = items.find((i) => i.id === instrumentId);
  useEffect(() => {
    void Promise.all([api<Sample[]>("/samples"), api<Operator[]>("/operators")])
      .then(([s, o]) => {
        setSamples(s);
        setOperators(o);
      })
      .catch((e) => setError(messageOf(e)));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      details: Record<string, unknown> = {};
    for (const key of [
      "temperatureMin",
      "temperatureMax",
      "fieldMin",
      "fieldMax",
      "targetTemperatureC",
    ])
      if (field(f, key)) details[key] = Number(f.get(key));
    for (const key of [
      "temperatureUnit",
      "fieldUnit",
      "sequence",
      "sampleMass",
      "mounting",
      "accessories",
      "stages",
      "atmosphere",
      "crucible",
      "targetMaterial",
      "substrate",
      "mode",
      "gas",
      "pressure",
      "power",
      "duration",
      "thickness",
      "preparation",
      "cleaning",
    ])
      if (f.has(key)) details[key] = field(f, key);
    try {
      await api(b ? `/bookings/${b.id}` : "/bookings", b ? "PUT" : "POST", {
        instrumentId,
        operatorId: field(f, "operatorId"),
        participantIds: f.getAll("participants"),
        sampleIds: selected,
        measurementType: field(f, "measurementType"),
        project: field(f, "project"),
        startsAt: fromIST(field(f, "startsAt")),
        endsAt: fromIST(field(f, "endsAt")),
        setupNotes: field(f, "setupNotes"),
        details,
        ...(b ? { version: b.version } : {}),
      });
      onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div hidden={quick}>
        <form onSubmit={submit}>
          <ErrorNotice message={error} />
          <div className="form-grid">
            <label>
              Instrument
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
              >
                {items
                  .filter((i) => !i.archived)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Actual operator
              <select
                name="operatorId"
                defaultValue={b?.operatorId ?? user.id}
                required
              >
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Measurement / process type
              <input
                name="measurementType"
                defaultValue={b?.measurementType ?? ""}
                list="measurement-options"
                required
                maxLength={150}
              />
              <datalist id="measurement-options">
                {[
                  "Magnetization/VSM",
                  "Heat capacity",
                  "Resistivity/transport",
                  "ADR/magnetocaloric",
                  "Annealing",
                  "Deposition",
                  "Other",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </datalist>
            </label>
            <Field
              label="Project"
              name="project"
              value={b?.project ?? user.project}
            />
            <Field
              label="Start (Asia/Kolkata)"
              name="startsAt"
              type="datetime-local"
              value={istInput(b?.startsAt ?? new Date().toISOString())}
              required
            />
            <Field
              label="End including cooling (Asia/Kolkata)"
              name="endsAt"
              type="datetime-local"
              value={istInput(
                b?.endsAt ?? new Date(Date.now() + 3600000).toISOString(),
              )}
              required
            />
            <fieldset className="full choices">
              <legend>Samples (select one or more)</legend>
              {samples
                .filter((s) => !s.archived || selected.includes(s.id))
                .map((s) => (
                  <label className="check-row" key={s.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, s.id]
                            : selected.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.code} · {s.compound}
                    {s.archived ? " (archived; choose an active sample)" : ""}
                  </label>
                ))}
              {!samples.length && <p>Create a sample before booking.</p>}
              <button
                type="button"
                className="secondary"
                onClick={() => setQuick(true)}
              >
                Quick create sample
              </button>
            </fieldset>
            <details className="full">
              <summary>Additional participants</summary>
              {operators.map((o) => (
                <label className="check-row" key={o.id}>
                  <input
                    type="checkbox"
                    name="participants"
                    value={o.id}
                    defaultChecked={b?.participants.some((p) => p.id === o.id)}
                  />
                  {o.fullName}
                </label>
              ))}
            </details>
          </div>
          <p className="field-hint">
            Buffers: {instrument?.setupMinutes ?? 0} minutes setup /{" "}
            {instrument?.cleanupMinutes ?? 0} minutes cleanup.{" "}
            {instrument?.coordinatorApproval
              ? "Requires lab manager approval. Requested slots are reserved."
              : "Internal reservation; check in to confirm actual usage."}
          </p>
          {instrument?.schedulingMode === "allocated" && (
            <p className="notice">
              This instrument requires an allocated availability window,
              including buffers.
            </p>
          )}
          <MeasurementFields key={instrumentId} instrument={instrument} b={b} />
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : b ? "Save changes" : "Reserve booking"}
          </button>
        </form>
      </div>
      {quick && (
        <div>
          <h3>Quick sample registration</h3>
          <SampleForm
            onSaved={(s) => {
              setSamples([s, ...samples]);
              setSelected([...selected, s.id]);
              setQuick(false);
            }}
          />
          <button className="secondary" onClick={() => setQuick(false)}>
            Back to booking
          </button>
          <p>
            The sample stays in the shared register; your booking is still a
            draft.
          </p>
        </div>
      )}
    </>
  );
}
function BookingDetails({
  b,
  user,
  onChanged,
  onEdit,
}: {
  b: Booking;
  user: Member;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const manager = managesOperations(user.appRole),
    own = manager || b.bookedBy === user.id || b.operatorId === user.id,
    scheduled = ["requested", "confirmed"].includes(b.status);
  async function act(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(`/bookings/${b.id}/actions`, "POST", {
        version: b.version,
        action: field(f, "action"),
        summary: field(f, "summary"),
        handoverNotes: field(f, "handoverNotes"),
        dataLink: field(f, "dataLink"),
        unloaded: f.has("unloaded"),
        ...(field(f, "overrunUntil")
          ? { overrunUntil: fromIST(field(f, "overrunUntil")) }
          : {}),
      });
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <BookingSummary b={b} />
      <details>
        <summary>Sample descriptions at booking</summary>
        {b.sampleSnapshots.map((s) => (
          <div className="panel" key={s.id}>
            <strong>
              {s.code} · {s.compound}
            </strong>
            <p>
              Batch: {s.batch || "—"} · Preparation: {s.preparedOn || "—"}
            </p>
            <p>
              {s.physicalForm} · {s.quantity} · {s.project}
            </p>
            <p>{s.notes}</p>
          </div>
        ))}
      </details>
      <p>
        Booked by {b.bookerName}. Project: {b.project || "—"}.
      </p>
      <p>
        Participants: {b.participants.map((p) => p.name).join(", ") || "None"}
      </p>
      <p>
        Reserved with buffers: {formatDate(b.reservedStart)} →{" "}
        {formatDate(b.reservedEnd)}
      </p>
      <p>
        {b.allocationReference
          ? `Allocated window: ${b.allocationReference}`
          : "Internal lab reservation; no institutional allocation claimed."}
      </p>
      <p>
        Actual start:{" "}
        {b.actualStart ? formatDate(b.actualStart) : "Not checked in"} · Actual
        end: {b.actualEnd ? formatDate(b.actualEnd) : "Not completed"}
      </p>
      {b.overrunUntil && (
        <p className="notice error">
          Overrun estimate: {formatDate(b.overrunUntil)}. Following reservations
          have not been moved.
        </p>
      )}
      <p>{b.setupNotes}</p>
      <details>
        <summary>Measurement and preparation details</summary>
        <dl>
          {Object.entries(b.details)
            .filter(([, v]) => v !== "" && v !== undefined)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k.replace(/[A-Z]/g, (c) => " " + c.toLowerCase())}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      </details>
      <p>
        <strong>Summary:</strong> {b.completionSummary || "Not recorded"}
      </p>
      <p>
        <strong>Handover:</strong> {b.handoverNotes || "Not recorded"}
      </p>
      {b.dataLink && (
        <a href={b.dataLink} target="_blank" rel="noreferrer">
          Result data ↗
        </a>
      )}
      {b.category === "Furnace" && (
        <p>Unloading: {b.unloaded ? "Confirmed" : "Not confirmed"}</p>
      )}
      {own &&
        ((b.kind === "maintenance" && manager) || b.kind === "booking") &&
        active(b) && (
          <>
            <ErrorNotice message={error} />
            {scheduled && b.kind === "booking" && (
              <button className="secondary" onClick={onEdit}>
                Edit / reschedule
              </button>
            )}
            <form onSubmit={act}>
              <label>
                Action
                <select name="action">
                  {b.status === "confirmed" &&
                    b.kind === "booking" &&
                    (manager || b.operatorId === user.id) && (
                      <option value="checkin">
                        Check in — confirm actual usage
                      </option>
                    )}
                  {b.status === "requested" && manager && (
                    <>
                      <option value="confirm">Approve booking</option>
                      <option value="reject">Reject booking</option>
                    </>
                  )}
                  {scheduled && (
                    <option value="cancel">Cancel reservation</option>
                  )}
                  {b.status === "in_progress" && (
                    <>
                      <option value="complete">Complete measurement</option>
                      <option value="interrupt">
                        Interrupt and release safely
                      </option>
                      <option value="overrun">Report overrun</option>
                    </>
                  )}
                </select>
              </label>
              <Notes label="Completion summary / reason" name="summary" />
              <Notes
                label="Handover notes"
                name="handoverNotes"
                value={b.handoverNotes}
              />
              {b.status === "in_progress" && (
                <>
                  <Field label="Result data link" name="dataLink" type="url" />
                  <Field
                    label="Estimated overrun end (Asia/Kolkata)"
                    name="overrunUntil"
                    type="datetime-local"
                  />
                  {b.category === "Furnace" && (
                    <label className="check-row">
                      <input name="unloaded" type="checkbox" />I confirm cooling
                      is complete and the furnace is unloaded.
                    </label>
                  )}
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Apply action"}
              </button>
            </form>
          </>
        )}
    </>
  );
}
export function Schedule({
  user,
  items,
}: {
  user: Member;
  items: Instrument[];
}) {
  const [date, setDate] = useState(day()),
    [view, setView] = useState("week"),
    [instrument, setInstrument] = useState(""),
    [mine, setMine] = useState(false),
    [bookings, setBookings] = useState<Booking[]>([]),
    [windows, setWindows] = useState<Availability[]>([]),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Booking | null | undefined>(),
    [selected, setSelected] = useState<Booking | null>(null),
    [block, setBlock] = useState<"maintenance" | "availability" | null>(null),
    [busy, setBusy] = useState(false);
  const start = view === "month" ? date.slice(0, 7) + "-01" : date;
  const moveDate = (direction: number) =>
    setDate(
      view === "month"
        ? new Date(
            Date.UTC(
              Number(date.slice(0, 4)),
              Number(date.slice(5, 7)) - 1 + direction,
              1,
            ),
          )
            .toISOString()
            .slice(0, 10)
        : addDays(date, direction * (view === "day" ? 1 : 7)),
    );
  const end =
    view === "month"
      ? new Date(Date.parse(start + "T00:00:00Z") + 32 * 86400000)
          .toISOString()
          .slice(0, 7) + "-01"
      : addDays(start, view === "day" ? 1 : 7);
  const reload = useCallback(async () => {
    try {
      const [b, w] = await Promise.all([
        api<Booking[]>("/bookings" + rangeQuery(start, end)),
        api<Availability[]>("/availability"),
      ]);
      setBookings(b);
      setWindows(w);
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }, [start, end]);
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30000);
    return () => clearInterval(t);
  }, [reload]);
  const filtered = bookings.filter(
    (b) =>
      (!instrument || b.instrumentId === instrument) &&
      (!mine || b.bookedBy === user.id || b.operatorId === user.id),
  );
  const days: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  async function saveBlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/" + block, "POST", {
        instrumentId: field(f, "instrumentId"),
        startsAt: fromIST(field(f, "startsAt")),
        endsAt: fromIST(field(f, "endsAt")),
        reason: field(f, "reason"),
      });
      setBlock(null);
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="section-title">
        <div>
          <h2>Instrument calendar</h2>
          <p>Asia/Kolkata · scheduled reservations and confirmed usage</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>
          Book instrument
        </button>
      </div>
      <ErrorNotice message={error} />
      <div className="schedule-controls">
        <label>
          View
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <label>
          Filter instrument
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
          >
            <option value="">All instruments</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          My bookings
        </label>
        <button className="secondary" onClick={() => void reload()}>
          Refresh schedule
        </button>
      </div>
      <div className="action-row">
        <button className="secondary" onClick={() => moveDate(-1)}>
          Previous
        </button>
        <button className="secondary" onClick={() => setDate(day())}>
          Today
        </button>
        <button className="secondary" onClick={() => moveDate(1)}>
          Next
        </button>
        {managesOperations(user.appRole) && (
          <>
            <button
              className="secondary"
              onClick={() => setBlock("maintenance")}
            >
              Add maintenance
            </button>
            <button
              className="secondary"
              onClick={() => setBlock("availability")}
            >
              Add allocated window
            </button>
          </>
        )}
      </div>
      <p className="field-hint">
        Requested bookings reserve a slot while awaiting approval. Buffers and
        maintenance block overlapping reservations. Phone layouts use a daily
        agenda.
      </p>
      <div className={`calendar calendar-${view}`}>
        {days.map((d) => (
          <section className="calendar-day" key={d}>
            <h3>
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "short",
                day: "numeric",
                month: "short",
              }).format(new Date(fromIST(d + "T00:00")))}
            </h3>
            {filtered
              .filter(
                (b) =>
                  day(b.startsAt) <= d &&
                  day(
                    new Date(new Date(b.endsAt).getTime() - 1).toISOString(),
                  ) >= d,
              )
              .map((b) => (
                <button
                  key={b.id}
                  className={`booking-tile ${b.status}`}
                  onClick={() => setSelected(b)}
                >
                  <strong>{b.instrumentName}</strong>
                  <span>{b.operatorName}</span>
                  <span>{b.measurementType}</span>
                  <span>
                    {b.sampleSnapshots.map((s) => s.compound).join(", ") ||
                      b.measurementType}
                  </span>
                  <span>
                    {istInput(b.startsAt).slice(11)}–
                    {istInput(b.endsAt).slice(11)} ·{" "}
                    {b.status.replaceAll("_", " ")}
                  </span>
                </button>
              ))}
            {!filtered.some(
              (b) =>
                day(b.startsAt) <= d &&
                day(new Date(new Date(b.endsAt).getTime() - 1).toISOString()) >=
                  d,
            ) && <p>No reservations</p>}
          </section>
        ))}
      </div>
      {filtered.some(
        (b) =>
          b.status === "in_progress" &&
          (day(b.endsAt) < start || day(b.startsAt) >= end),
      ) && (
        <section className="panel">
          <h3>Still in use from another date</h3>
          {filtered
            .filter(
              (b) =>
                b.status === "in_progress" &&
                (day(b.endsAt) < start || day(b.startsAt) >= end),
            )
            .map((b) => (
              <button
                key={b.id}
                className="secondary"
                onClick={() => setSelected(b)}
              >
                {b.instrumentName} — {b.operatorName}
              </button>
            ))}
        </section>
      )}
      <details>
        <summary>Allocated availability windows</summary>
        {windows
          .filter((w) => !instrument || w.instrumentId === instrument)
          .map((w) => (
            <p key={w.id}>
              {items.find((i) => i.id === w.instrumentId)?.name}:{" "}
              {formatDate(w.startsAt)} → {formatDate(w.endsAt)} · {w.reference}
            </p>
          ))}
        {!windows.length && (
          <p>No institutionally allocated windows recorded.</p>
        )}
      </details>
      {editing !== undefined && (
        <Modal
          title={editing ? "Edit booking" : "Book instrument"}
          onClose={() => setEditing(undefined)}
        >
          <div className="dialog-body">
            <BookingForm
              user={user}
              items={items}
              b={editing ?? undefined}
              onSaved={() => {
                setEditing(undefined);
                void reload();
              }}
            />
          </div>
        </Modal>
      )}
      {selected && (
        <Modal title="Booking details" onClose={() => setSelected(null)}>
          <div className="dialog-body">
            <BookingDetails
              b={selected}
              user={user}
              onChanged={() => {
                setSelected(null);
                void reload();
              }}
              onEdit={() => {
                setEditing(selected);
                setSelected(null);
              }}
            />
          </div>
        </Modal>
      )}
      {block && (
        <Modal
          title={
            block === "maintenance"
              ? "Maintenance block"
              : "Allocated availability window"
          }
          onClose={() => setBlock(null)}
        >
          <form className="dialog-body" onSubmit={saveBlock}>
            <ErrorNotice message={error} />
            <label>
              Instrument
              <select name="instrumentId">
                {items
                  .filter((i) => !i.archived)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              label="Start (Asia/Kolkata)"
              name="startsAt"
              type="datetime-local"
              required
            />
            <Field
              label="End (Asia/Kolkata)"
              name="endsAt"
              type="datetime-local"
              required
            />
            <Field
              label={
                block === "maintenance"
                  ? "Maintenance reason"
                  : "Allocation reference"
              }
              name="reason"
              required
            />
            <button className="primary" disabled={busy}>
              Save block
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function LiveUsage({
  items,
  user,
  onCalendar,
}: {
  items: Instrument[];
  user: Member;
  onCalendar: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[]>([]),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState("");
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Booking[]>(
        "/bookings" + rangeQuery(addDays(day(), -1), addDays(day(), 90)),
      )
        .then((b) => {
          if (!stopped) {
            setBookings(b);
            setUpdated(new Date().toISOString());
            setError("");
          }
        })
        .catch((e) => {
          if (!stopped) setError(messageOf(e));
        });
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);
  const now = Date.now();
  if (!updated)
    return (
      <section>
        <ErrorNotice message={error} />
        <p role="status">Loading confirmed usage and reservations…</p>
      </section>
    );
  return (
    <section>
      <div className="section-title">
        <h2>Usage & next reservations</h2>
        <button className="secondary" onClick={onCalendar}>
          Open calendar
        </button>
      </div>
      <ErrorNotice message={error} />
      <p className="field-hint">
        Manual check-in confirms actual usage. Scheduled time alone does not.{" "}
        {updated && `Refreshed ${formatDate(updated)}.`}
      </p>
      <div className="sample-grid">
        {items
          .filter((i) => i.priority && !i.archived)
          .map((i) => {
            const list = bookings.filter((b) => b.instrumentId === i.id),
              running = list.find((b) => b.status === "in_progress"),
              scheduled = list.find(
                (b) =>
                  b.status === "confirmed" &&
                  new Date(b.startsAt).getTime() <= now &&
                  new Date(b.endsAt).getTime() > now,
              ),
              next = list.find(
                (b) => active(b) && new Date(b.startsAt).getTime() > now,
              ),
              cooldown = list.find(
                (b) =>
                  b.actualEnd &&
                  new Date(b.actualEnd).getTime() + b.cleanupMinutes * 60000 >
                    now,
              );
            return (
              <article className="panel" key={i.id}>
                <h3>{i.name}</h3>
                <strong>
                  {running
                    ? "Confirmed in use"
                    : cooldown
                      ? "Cleanup buffer active"
                      : scheduled
                        ? scheduled.kind === "maintenance"
                          ? "Scheduled maintenance"
                          : "Scheduled now · not checked in"
                        : i.status !== "available"
                          ? i.status
                          : "No confirmed usage"}
                </strong>
                {running && (
                  <>
                    <p>
                      {running.operatorName} ·{" "}
                      {running.sampleSnapshots
                        .map((s) => s.compound)
                        .join(", ")}
                    </p>
                    <p>
                      {running.measurementType} · checked in{" "}
                      {formatDate(running.actualStart!)}
                    </p>
                    {new Date(running.endsAt).getTime() < now && (
                      <p className="notice error">
                        Overdue — awaiting completion
                        {running.category === "Furnace" ? " and unloading" : ""}
                        . Next booking may be affected.
                      </p>
                    )}
                    <p>Usage updated {formatDate(running.updatedAt)}</p>
                    <p>{running.handoverNotes}</p>
                  </>
                )}
                {scheduled && !running && (
                  <p>
                    {scheduled.operatorName} · {scheduled.measurementType} ·{" "}
                    {scheduled.sampleSnapshots
                      .map((s) => s.compound)
                      .join(", ")}
                  </p>
                )}
                <p>
                  <strong>Next:</strong>{" "}
                  {next
                    ? `${formatDate(next.startsAt)} · ${next.operatorName} · ${next.measurementType} · ${next.status}`
                    : "No booking in the next 90 days"}
                </p>
                <details>
                  <summary>Instrument details</summary>
                  <p>{i.bookingRules || "No additional rules recorded."}</p>
                  <p>
                    Setup {i.setupMinutes} min · cleanup {i.cleanupMinutes} min
                  </p>
                  <p>Training: {i.trainedUsers.join(", ") || "Not recorded"}</p>
                  <p>{i.trainingPolicy}</p>
                </details>
              </article>
            );
          })}
      </div>
      <div className="panel">
        <h3>My upcoming measurements</h3>
        {bookings
          .filter(
            (b) =>
              active(b) &&
              (b.operatorId === user.id || b.bookedBy === user.id) &&
              new Date(b.endsAt).getTime() > now,
          )
          .slice(0, 10)
          .map((b) => (
            <p key={b.id}>
              {b.instrumentName} · {b.measurementType} ·{" "}
              {formatDate(b.startsAt)} · {b.status.replaceAll("_", " ")}
            </p>
          ))}
      </div>
    </section>
  );
}
export function Notifications({
  onIssue,
  onWeekly,
}: {
  onWeekly: (id: string) => void;
  onIssue: (id: string) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]),
    [error, setError] = useState(""),
    [booking, setBooking] = useState<Booking | null>(null);
  const reload = useCallback(
    () =>
      api<Notification[]>("/notifications")
        .then(setItems)
        .catch((e) => setError(messageOf(e))),
    [],
  );
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <section>
      <h2>In-app notifications</h2>
      <p>
        Persistent booking, weekly progress and issue/request updates. Refreshed
        every 30 seconds while open.
      </p>
      <ErrorNotice message={error} />
      {!items.length && <p>No notifications yet.</p>}
      {items.map((n) => (
        <article className="panel" key={n.id}>
          <p>
            <strong>{n.readAt ? "Read" : "Unread"}</strong> ·{" "}
            {formatDate(n.createdAt)}
          </p>
          <p>{n.message}</p>
          <div className="action-row">
            {n.issueId ? (
              <button className="secondary" onClick={() => onIssue(n.issueId!)}>
                View issue/request
              </button>
            ) : n.weeklyReportId ? (
              <button
                className="secondary"
                onClick={() => onWeekly(n.weeklyReportId!)}
              >
                View weekly report
              </button>
            ) : (
              <button
                className="secondary"
                onClick={() =>
                  void api<Booking>(`/bookings/${n.bookingId}`)
                    .then(setBooking)
                    .catch((e) => setError(messageOf(e)))
                }
              >
                View booking
              </button>
            )}
            {!n.readAt && (
              <button
                className="secondary"
                onClick={() =>
                  void api(`/notifications/${n.id}/read`, "POST", {})
                    .then(reload)
                    .catch((e) => setError(messageOf(e)))
                }
              >
                Mark read
              </button>
            )}
          </div>
        </article>
      ))}
      {booking && (
        <Modal title="Booking notification" onClose={() => setBooking(null)}>
          <div className="dialog-body">
            <BookingSummary b={booking} />
            <p>{booking.handoverNotes}</p>
          </div>
        </Modal>
      )}
    </section>
  );
}
