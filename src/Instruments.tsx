import { useState, type FormEvent } from "react";
import type { Instrument, InstrumentInput } from "../shared/schema.js";
import { operationalStatuses } from "../shared/options.js";
import { api } from "./api.js";
import {
  Empty,
  ErrorNotice,
  Icon,
  Modal,
  Status,
  formatDate,
  messageOf,
} from "./components.js";

export function InstrumentCard({
  instrument: i,
  onEdit,
}: {
  instrument: Instrument;
  onEdit?: (i: Instrument) => void;
}) {
  return (
    <article className={`instrument-card ${i.archived ? "archived-card" : ""}`}>
      <div className="card-top">
        <span className="instrument-symbol">
          <Icon name="instruments" />
        </span>
        <Status value={i.archived ? "archived" : i.status} />
      </div>
      <p className="category">{i.category}</p>
      <h3>{i.name}</h3>
      <p className="instrument-location">
        {i.location || "Location not recorded"}
      </p>
      <div className="card-facts">
        {i.maxTemperatureC !== null ? (
          <span>
            Maximum <strong>{i.maxTemperatureC} °C</strong>
          </span>
        ) : (
          <span>No operating limits supplied</span>
        )}
        <span>
          {i.schedulingMode === "internal"
            ? "Internal scheduling"
            : "Allocated-window scheduling"}
        </span>
      </div>
      <details>
        <summary>Instrument details</summary>
        <div className="instrument-details">
          {i.description && <p>{i.description}</p>}
          <h4>Trained-user directory</h4>
          <p>
            {i.trainedUsers.length
              ? i.trainedUsers.join(" · ")
              : i.trainingNote || "None listed"}
          </p>
          {i.trainingNote && i.trainedUsers.length > 0 && (
            <p>{i.trainingNote}</p>
          )}
          <small>
            Names are directory records, not accounts or operating approval.
          </small>
          <h4>Training policy</h4>
          <p>
            {i.trainingPolicy ||
              "Not configured. Confirm authorization with the lab before operating."}
          </p>
          <h4>Booking configuration</h4>
          <p>{i.bookingRules || "No additional rules recorded."}</p>
          <p>
            Setup: {i.setupMinutes} min · Cleanup: {i.cleanupMinutes} min
            <br />
            Coordinator approval:{" "}
            {i.coordinatorApproval ? "Required" : "Not required"}
          </p>
          <p>Bookings and allocation windows will be implemented in Phase 2.</p>
          {i.sopLinks.length > 0 && (
            <>
              <h4>Standard operating procedures</h4>
              <ul>
                {i.sopLinks.map((link, n) => (
                  <li key={n}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
              <small>
                Use access-controlled destinations for private documents.
              </small>
            </>
          )}
          <p className="updated">Updated {formatDate(i.updatedAt)} IST</p>
        </div>
      </details>
      {onEdit && (
        <button className="card-edit" onClick={() => onEdit(i)}>
          Edit instrument <Icon name="arrow" />
        </button>
      )}
    </article>
  );
}
const blank: InstrumentInput = {
  name: "",
  category: "",
  location: "",
  description: "",
  status: "available",
  priority: false,
  maxTemperatureC: null,
  bookingRules: "",
  schedulingMode: "internal",
  coordinatorApproval: false,
  setupMinutes: 0,
  cleanupMinutes: 0,
  trainingPolicy: "",
  trainingNote: "",
  trainedUsers: [],
  sopLinks: [],
  archived: false,
};
export function InstrumentEditor({
  instrument,
  onClose,
  onSaved,
}: {
  instrument: Instrument | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const value = instrument ?? blank;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(event.currentTarget);
    const str = (key: string) => String(f.get(key) ?? "").trim();
    try {
      const sopLinks = str("sopLinks")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("|");
          if (index < 1)
            throw new Error("Enter each SOP link as Title | https://address.");
          return {
            label: line.slice(0, index).trim(),
            url: line.slice(index + 1).trim(),
          };
        });
      await api(
        `/instruments${instrument ? `/${instrument.id}` : ""}`,
        instrument ? "PUT" : "POST",
        {
          name: str("name"),
          category: str("category"),
          location: str("location"),
          description: str("description"),
          status: str("status"),
          priority: f.has("priority"),
          maxTemperatureC: str("maxTemperatureC")
            ? Number(str("maxTemperatureC"))
            : null,
          bookingRules: str("bookingRules"),
          schedulingMode: str("schedulingMode"),
          coordinatorApproval: f.has("coordinatorApproval"),
          setupMinutes: Number(str("setupMinutes")),
          cleanupMinutes: Number(str("cleanupMinutes")),
          trainingPolicy: str("trainingPolicy"),
          trainingNote: str("trainingNote"),
          trainedUsers: str("trainedUsers")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          sopLinks,
          archived: f.has("archived"),
          ...(instrument ? { version: instrument.version } : {}),
        },
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={instrument ? "Edit instrument" : "Add instrument"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="dialog-body">
        <ErrorNotice message={error} />
        <div className="form-grid">
          <label className="full">
            Instrument name
            <input
              name="name"
              defaultValue={value.name}
              required
              minLength={2}
              maxLength={150}
            />
          </label>
          <label>
            Category
            <input
              name="category"
              defaultValue={value.category}
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label>
            Location
            <input
              name="location"
              defaultValue={value.location}
              maxLength={200}
            />
          </label>
          <label>
            Operational status
            <select name="status" defaultValue={value.status}>
              {operationalStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Maximum temperature (°C)
            <input
              name="maxTemperatureC"
              type="number"
              min="0.01"
              max="10000"
              step="any"
              defaultValue={value.maxTemperatureC ?? ""}
            />
            <small className="field-hint">
              Leave blank when not specified by the lab.
            </small>
          </label>
          <label className="full">
            Description
            <textarea
              name="description"
              defaultValue={value.description}
              rows={3}
              maxLength={2000}
            />
          </label>
          <label className="check full">
            <input
              name="priority"
              type="checkbox"
              defaultChecked={value.priority}
            />{" "}
            Show among priority instruments
          </label>
        </div>
        <fieldset>
          <legend>Booking configuration</legend>
          <p className="field-hint">
            Saved for the Phase 2 booking workflow. These settings do not create
            reservations or facility approvals.
          </p>
          <div className="form-grid">
            <label>
              Scheduling mode
              <select name="schedulingMode" defaultValue={value.schedulingMode}>
                <option value="internal">Internal lab scheduling</option>
                <option value="allocated">
                  Institutional availability windows
                </option>
              </select>
            </label>
            <label className="check">
              <input
                name="coordinatorApproval"
                type="checkbox"
                defaultChecked={value.coordinatorApproval}
              />{" "}
              Require coordinator approval
            </label>
            <label>
              Setup buffer (minutes)
              <input
                name="setupMinutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={value.setupMinutes}
                required
              />
            </label>
            <label>
              Cleanup buffer (minutes)
              <input
                name="cleanupMinutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={value.cleanupMinutes}
                required
              />
            </label>
            <label className="full">
              Additional booking rules
              <textarea
                name="bookingRules"
                defaultValue={value.bookingRules}
                rows={3}
                maxLength={2000}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Training & SOPs</legend>
          <label>
            Training policy
            <textarea
              name="trainingPolicy"
              defaultValue={value.trainingPolicy}
              maxLength={2000}
              rows={2}
            />
          </label>
          <label>
            Trained-user names (one per line)
            <textarea
              name="trainedUsers"
              defaultValue={value.trainedUsers.join("\n")}
              rows={3}
            />
            <small className="field-hint">
              Preserve supplied spellings. Akhil N and Akhila are different
              people. Entries do not create accounts.
            </small>
          </label>
          <label>
            Training directory note
            <input
              name="trainingNote"
              defaultValue={value.trainingNote}
              maxLength={250}
            />
          </label>
          <label>
            SOP links (one per line: Title | https://address)
            <textarea
              name="sopLinks"
              defaultValue={value.sopLinks
                .map((s) => `${s.label} | ${s.url}`)
                .join("\n")}
              rows={3}
            />
            <small className="field-hint">
              Store private documents behind access control. Do not paste public
              sharing links to private lab data.
            </small>
          </label>
        </fieldset>
        {instrument && (
          <label className="check">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={value.archived}
            />{" "}
            Archive this instrument (preserves history)
          </label>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save instrument"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function InstrumentRegister({
  items,
  admin,
  reload,
  includeArchived,
  setIncludeArchived,
}: {
  items: Instrument[];
  admin: boolean;
  reload: () => Promise<void>;
  includeArchived: boolean;
  setIncludeArchived: (v: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Instrument | null | undefined>();
  const filtered = items.filter(
    (i) =>
      `${i.name} ${i.category} ${i.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" || i.status === status),
  );
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Instrument register</h2>
          <p>Shared resources, operating status, and essential details.</p>
        </div>
        {admin && (
          <button className="primary" onClick={() => setEditor(null)}>
            ＋ Add instrument
          </button>
        )}
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search instruments"
            placeholder="Search instruments, category, or location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter operational status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {operationalStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {admin && (
          <label className="check">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />{" "}
            Include archived
          </label>
        )}
      </div>
      <p className="result-count">
        {filtered.length} instrument{filtered.length === 1 ? "" : "s"}
      </p>
      {filtered.length ? (
        <div className="instrument-grid">
          {filtered.map((i) => (
            <InstrumentCard
              key={i.id}
              instrument={i}
              onEdit={admin ? setEditor : undefined}
            />
          ))}
        </div>
      ) : (
        <Empty title="No matching instruments">
          Try another search or status filter.
        </Empty>
      )}
      {editor !== undefined && (
        <InstrumentEditor
          instrument={editor}
          onClose={() => setEditor(undefined)}
          onSaved={reload}
        />
      )}
    </>
  );
}
