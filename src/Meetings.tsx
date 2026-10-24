import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Member } from "../shared/schema.js";
import {
  meetingManager,
  type Meeting,
  type MeetingInput,
  type MeetingDetail,
  type Notice,
  type NoticeInput,
  type NoticeDetail,
  type CollaborationSummary,
} from "../shared/meetings.js";
import { fromIST, istInput } from "../shared/scheduling-ui.js";
import { api } from "./api.js";
import { ErrorNotice, Modal, formatDate, messageOf } from "./components.js";

type Link = NoticeInput["dataLinks"][number];
type Selection = { kind: "meeting" | "notice"; id: string };
type Person = { id: string; fullName: string; active: boolean };
function Links({ items }: { items: Link[] }) {
  return items.length ? (
    <ul>
      {items.map((l, i) => (
        <li key={i}>
          <a href={l.url} target="_blank" rel="noreferrer">
            {l.label} ↗
          </a>
        </li>
      ))}
    </ul>
  ) : null;
}
function LinkFields({
  value,
  onChange,
}: {
  value: Link[];
  onChange: (value: Link[]) => void;
}) {
  return (
    <fieldset>
      <legend>Data links (optional)</legend>
      <p>
        Share access to linked data separately. File uploads are not configured.
      </p>
      {value.map((l, i) => (
        <div className="issue-link-row" key={i}>
          <label>
            Link {i + 1} label
            <input
              required
              maxLength={150}
              value={l.label}
              onChange={(e) =>
                onChange(
                  value.map((v, n) =>
                    n === i ? { ...v, label: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Link {i + 1} URL
            <input
              type="url"
              required
              maxLength={1000}
              value={l.url}
              onChange={(e) =>
                onChange(
                  value.map((v, n) =>
                    n === i ? { ...v, url: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Remove link {i + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={value.length >= 10}
        onClick={() => onChange([...value, { label: "", url: "" }])}
      >
        Add data link
      </button>
    </fieldset>
  );
}
function MeetingCard({
  item: m,
  open,
}: {
  item: Meeting;
  open: (s: Selection) => void;
}) {
  return (
    <article className="panel collaboration-card">
      <span className="status">
        {m.kind} · {m.status}
      </span>
      <h3>
        <button
          className="text-button"
          onClick={() => open({ kind: "meeting", id: m.id })}
        >
          {m.title}
        </button>
      </h3>
      <p>
        {formatDate(m.startsAt)} – {formatDate(m.endsAt)} · Asia/Kolkata
      </p>
      <p>
        {m.venue || "Venue not set"} · {m.attendees.length} selected attendee(s)
      </p>
    </article>
  );
}
function NoticeCard({
  item: n,
  open,
}: {
  item: Notice;
  open: (s: Selection) => void;
}) {
  return (
    <article className="panel collaboration-card">
      <span className="status">
        {n.status}
        {n.pinned ? " · pinned" : ""}
        {n.expired ? " · expired" : ""}
      </span>
      <h3>
        <button
          className="text-button"
          onClick={() => open({ kind: "notice", id: n.id })}
        >
          {n.title}
        </button>
      </h3>
      <p>
        {n.publishedAt
          ? `Published ${formatDate(n.publishedAt)}`
          : "Private manager draft"}{" "}
        · Asia/Kolkata
      </p>
      {n.acknowledgementRequired && (
        <p>
          {n.acknowledged
            ? "Read acknowledgement recorded for this revision"
            : "Explicit read acknowledgement requested"}
        </p>
      )}
    </article>
  );
}
function MeetingForm({
  initial,
  people,
  saved,
  cancel,
}: {
  initial: Meeting | null;
  people: Person[];
  saved: (m: MeetingDetail) => void;
  cancel: () => void;
}) {
  const [data, setData] = useState<MeetingInput>(() =>
    initial
      ? {
          title: initial.title,
          kind: initial.kind,
          attendeeIds: initial.attendeeIds,
          startsAt: initial.startsAt,
          endsAt: initial.endsAt,
          agenda: initial.agenda,
          venue: initial.venue,
          videoUrl: initial.videoUrl,
          dataLinks: initial.dataLinks,
        }
      : {
          title: "",
          kind: "group",
          attendeeIds: [],
          startsAt: new Date(Date.now() + 3600000).toISOString(),
          endsAt: new Date(Date.now() + 7200000).toISOString(),
          agenda: "",
          venue: "",
          videoUrl: "",
          dataLinks: [],
        },
  );
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const choices = [
    ...people,
    ...(initial?.attendees.filter((p) => !people.some((x) => x.id === p.id)) ??
      []),
  ];
  function set<K extends keyof MeetingInput>(key: K, value: MeetingInput[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      saved(
        await api<MeetingDetail>(
          initial ? `/meetings/${initial.id}` : "/meetings",
          initial ? "PUT" : "POST",
          { ...data, ...(initial ? { version: initial.version, reason } : {}) },
        ),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="collaboration-form" onSubmit={(e) => void submit(e)}>
      <ErrorNotice message={error} />
      <label>
        Meeting title
        <input
          required
          minLength={3}
          maxLength={180}
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label>
        Meeting type
        <select
          value={data.kind}
          onChange={(e) => set("kind", e.target.value as MeetingInput["kind"])}
        >
          <option value="group">Group</option>
          <option value="individual">Individual</option>
        </select>
      </label>
      <p>
        Only selected attendees and application supervisors/administrators can
        view this meeting and its notes. Group meetings also use explicit
        attendee selection.
      </p>
      <fieldset>
        <legend>Selected attendees</legend>
        <div className="collaboration-attendees">
          {choices.map((p) => (
            <label className="checkbox-label" key={p.id}>
              <input
                type="checkbox"
                checked={data.attendeeIds.includes(p.id)}
                onChange={(e) =>
                  set(
                    "attendeeIds",
                    e.target.checked
                      ? [...data.attendeeIds, p.id]
                      : data.attendeeIds.filter((id) => id !== p.id),
                  )
                }
              />
              {p.fullName}
              {!p.active && " (inactive; retained)"}
            </label>
          ))}
        </div>
        <small>Select at least one attendee.</small>
      </fieldset>
      <div className="collaboration-columns">
        <label>
          Start (Asia/Kolkata)
          <input
            type="datetime-local"
            required
            value={istInput(data.startsAt)}
            onChange={(e) => {
              if (e.target.value) set("startsAt", fromIST(e.target.value));
            }}
          />
        </label>
        <label>
          End (Asia/Kolkata)
          <input
            type="datetime-local"
            required
            value={istInput(data.endsAt)}
            onChange={(e) => {
              if (e.target.value) set("endsAt", fromIST(e.target.value));
            }}
          />
        </label>
      </div>
      <label>
        Agenda
        <textarea
          maxLength={8000}
          value={data.agenda}
          onChange={(e) => set("agenda", e.target.value)}
        />
      </label>
      <label>
        Venue
        <input
          maxLength={500}
          value={data.venue}
          onChange={(e) => set("venue", e.target.value)}
        />
      </label>
      <label>
        Video link (optional)
        <input
          type="url"
          maxLength={1000}
          value={data.videoUrl}
          onChange={(e) => set("videoUrl", e.target.value)}
        />
      </label>
      <LinkFields
        value={data.dataLinks}
        onChange={(v) => set("dataLinks", v)}
      />
      {initial && (
        <label>
          Change reason (optional)
          <textarea
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className="action-row">
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : initial
              ? "Save meeting changes"
              : "Schedule meeting"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={cancel}
        >
          Back
        </button>
      </div>
    </form>
  );
}
function NoticeForm({
  initial,
  saved,
  cancel,
}: {
  initial: Notice | null;
  saved: (n: NoticeDetail) => void;
  cancel: () => void;
}) {
  const [data, setData] = useState<NoticeInput>(
    initial
      ? {
          title: initial.title,
          body: initial.body,
          pinned: initial.pinned,
          expiresAt: initial.expiresAt,
          acknowledgementRequired: initial.acknowledgementRequired,
          dataLinks: initial.dataLinks,
        }
      : {
          title: "",
          body: "",
          pinned: false,
          expiresAt: null,
          acknowledgementRequired: false,
          dataLinks: [],
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function set<K extends keyof NoticeInput>(key: K, value: NoticeInput[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      saved(
        await api<NoticeDetail>(
          initial ? `/notices/${initial.id}` : "/notices",
          initial ? "PUT" : "POST",
          { ...data, ...(initial ? { version: initial.version } : {}) },
        ),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="collaboration-form" onSubmit={(e) => void submit(e)}>
      <ErrorNotice message={error} />
      <label>
        Notice title
        <input
          required
          minLength={3}
          maxLength={180}
          value={data.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label>
        Notice text
        <textarea
          required
          maxLength={12000}
          value={data.body}
          onChange={(e) => set("body", e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={data.pinned}
          onChange={(e) => set("pinned", e.target.checked)}
        />
        Pin on dashboard
      </label>
      <label>
        Expiry (Asia/Kolkata, optional)
        <input
          type="datetime-local"
          value={data.expiresAt ? istInput(data.expiresAt) : ""}
          onChange={(e) =>
            set("expiresAt", e.target.value ? fromIST(e.target.value) : null)
          }
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={data.acknowledgementRequired}
          onChange={(e) => set("acknowledgementRequired", e.target.checked)}
        />
        Request explicit read acknowledgement
      </label>
      <p>
        Acknowledgement confirms reading, not approval or agreement. Each saved
        published revision needs its own confirmation. Expiry is evaluated when
        viewed; no background reminder runs.
      </p>
      <LinkFields
        value={data.dataLinks}
        onChange={(v) => set("dataLinks", v)}
      />
      <div className="action-row">
        <button className="primary" disabled={busy}>
          {busy
            ? "Saving…"
            : initial
              ? "Save notice changes"
              : "Save notice draft"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={cancel}
        >
          Back
        </button>
      </div>
    </form>
  );
}
function MeetingDetailView({
  initial,
  user,
  people,
  changed,
}: {
  initial: MeetingDetail;
  user: Member;
  people: Person[];
  changed: () => void;
}) {
  const [m, setM] = useState(initial),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState("");
  const [note, setNote] = useState(""),
    [links, setLinks] = useState<Link[]>([]),
    [reason, setReason] = useState("");
  const staff = meetingManager(user.appRole);
  async function mutate(path: string, body: object, done?: () => void) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      setM(await api<MeetingDetail>(`/meetings/${m.id}${path}`, "POST", body));
      done?.();
      setSuccess("Saved. History retained.");
      changed();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setError("");
    try {
      const r = await fetch(`/api/meetings/${m.id}/calendar`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok)
        throw new Error((await r.json()).error || "Calendar export failed.");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `quemat-meeting-${m.id}.ics`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(messageOf(e));
    }
  }
  if (editing)
    return (
      <MeetingForm
        initial={m}
        people={people}
        saved={(value) => {
          setM(value);
          setEditing(false);
          changed();
        }}
        cancel={() => setEditing(false)}
      />
    );
  return (
    <div className="collaboration-detail">
      <ErrorNotice message={error} />
      {success && <p role="status">{success}</p>}
      <h3>{m.title}</h3>
      <p>
        {m.kind} · {m.status} · revision {m.version}
      </p>
      <p>
        {formatDate(m.startsAt)} – {formatDate(m.endsAt)} · Asia/Kolkata
      </p>
      <p>
        Organized by {m.createdName} · {m.venue || "Venue not set"}
      </p>
      {m.videoUrl && (
        <p>
          <a href={m.videoUrl} target="_blank" rel="noreferrer">
            Open video link ↗
          </a>
        </p>
      )}
      <h4>Selected attendees</h4>
      <ul>
        {m.attendees.map((p) => (
          <li key={p.id}>
            {p.fullName}
            {!p.active && " (inactive)"}
          </li>
        ))}
      </ul>
      <h4>Agenda</h4>
      <p className="preserve-lines">{m.agenda || "No agenda provided."}</p>
      <Links items={m.dataLinks} />
      <div className="action-row">
        <button className="secondary" onClick={() => void download()}>
          Export calendar (.ics)
        </button>
        {staff && m.status === "scheduled" && (
          <button className="secondary" onClick={() => setEditing(true)}>
            Edit / reschedule meeting
          </button>
        )}
      </div>
      <p className="muted">
        Export is a private snapshot, not a live subscription or invitation.
        Re-export after changes; the stable event ID and revision support
        calendar updates.
      </p>
      {staff && m.status === "scheduled" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (window.confirm("Cancel this meeting and retain its history?"))
              void mutate("/cancel", { version: m.version, reason });
          }}
        >
          <label>
            Cancellation reason (optional)
            <textarea
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy}>
            Cancel meeting
          </button>
        </form>
      )}
      <section>
        <h3>Meeting notes</h3>
        <p>Notes are retained. Add a correction as a new note.</p>
        {m.notes.map((n) => (
          <article className="panel" key={n.id}>
            <p>
              <strong>{n.authorName}</strong> · {formatDate(n.createdAt)}
            </p>
            <p className="preserve-lines">{n.body}</p>
            <Links items={n.dataLinks} />
          </article>
        ))}
        <form
          className="collaboration-form"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate("/notes", { body: note, dataLinks: links }, () => {
              setNote("");
              setLinks([]);
            });
          }}
        >
          <label>
            Add meeting note
            <textarea
              required
              maxLength={8000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <LinkFields value={links} onChange={setLinks} />
          <button className="primary" disabled={busy}>
            Add note
          </button>
        </form>
      </section>
      <section>
        <h3>Action items</h3>
        {!m.actions.length && <p>No action items yet.</p>}
        {m.actions.map((a) => (
          <article className="panel" key={a.id}>
            <h4>{a.title}</h4>
            <p>
              Owner: {a.ownerName} · Due: {a.dueDate || "Not set"} · {a.status}
            </p>
            {a.completedAt && (
              <p>
                Completed by {a.completedName} · {formatDate(a.completedAt)}
              </p>
            )}
            {(staff || a.ownerId === user.id) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(`/actions/${a.id}`, {
                    version: a.version,
                    status: a.status === "open" ? "done" : "open",
                  })
                }
              >
                {a.status === "open" ? "Complete action" : "Reopen action"}
              </button>
            )}
            <details>
              <summary>Completion history</summary>
              <ul>
                {a.events.map((e) => (
                  <li key={e.id}>
                    {e.status} · {e.actorName} · {formatDate(e.createdAt)}
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
        {staff && m.status === "scheduled" && (
          <form
            className="collaboration-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                data = new FormData(form);
              void mutate(
                "/actions",
                {
                  title: data.get("title"),
                  ownerId: data.get("owner"),
                  dueDate: data.get("due") || null,
                },
                () => form.reset(),
              );
            }}
          >
            <label>
              Action item
              <input name="title" required minLength={3} maxLength={500} />
            </label>
            <label>
              Action owner
              <select name="owner" required defaultValue="">
                <option value="" disabled>
                  Select an attendee
                </option>
                {m.attendees
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Action due date (optional, Asia/Kolkata)
              <input name="due" type="date" />
            </label>
            <button className="primary" disabled={busy}>
              Assign action
            </button>
          </form>
        )}
      </section>
      <details>
        <summary>Meeting change history</summary>
        <ol className="issue-history">
          {m.events.map((e) => (
            <li key={e.id}>
              <p>
                {e.kind} · revision {e.version} · {e.actorName} ·{" "}
                {formatDate(e.createdAt)}
              </p>
              <p>{e.reason || "No reason provided."}</p>
              <details>
                <summary>Saved meeting at this change</summary>
                <p>
                  {e.after.title} · {e.after.status}
                </p>
                <p>
                  {formatDate(e.after.startsAt)} – {formatDate(e.after.endsAt)}{" "}
                  · Asia/Kolkata
                </p>
                <p>
                  Attendees:{" "}
                  {e.after.attendees.map((p) => p.fullName).join(", ")}
                </p>
                <p className="preserve-lines">{e.after.agenda}</p>
                <p>{e.after.venue}</p>
                {e.after.videoUrl && (
                  <p>
                    <a href={e.after.videoUrl} target="_blank" rel="noreferrer">
                      Saved video link ↗
                    </a>
                  </p>
                )}
                <Links items={e.after.dataLinks} />
              </details>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
function NoticeDetailView({
  initial,
  user,
  changed,
}: {
  initial: NoticeDetail;
  user: Member;
  changed: () => void;
}) {
  const [n, setN] = useState(initial),
    [editing, setEditing] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const staff = meetingManager(user.appRole);
  async function mutate(operation: string, data: object) {
    setBusy(true);
    setError("");
    try {
      setN(
        await api<NoticeDetail>(`/notices/${n.id}/${operation}`, "POST", data),
      );
      setConfirmed(false);
      changed();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <NoticeForm
        initial={n}
        saved={(value) => {
          setN(value);
          setEditing(false);
          setConfirmed(false);
          changed();
        }}
        cancel={() => setEditing(false)}
      />
    );
  return (
    <div className="collaboration-detail">
      <ErrorNotice message={error} />
      <h3>{n.title}</h3>
      <p>
        {n.status}
        {n.pinned ? " · pinned" : ""}
        {n.expired ? " · expired" : ""} · revision {n.version}
      </p>
      <p>
        {n.publishedAt
          ? `First published ${formatDate(n.publishedAt)}`
          : "Manager draft; not visible to members"}{" "}
        · {n.createdName}
      </p>
      <p>
        {n.expiresAt
          ? `Expires ${formatDate(n.expiresAt)} · Asia/Kolkata`
          : "No expiry set"}
      </p>
      <p className="preserve-lines">{n.body}</p>
      <Links items={n.dataLinks} />
      {staff && (
        <div className="action-row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit notice
          </button>
          {n.status !== "published" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void mutate("publish", { version: n.version })}
            >
              Publish notice
            </button>
          )}
          {n.status !== "withdrawn" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm("Withdraw this notice and retain its history?")
                )
                  void mutate("withdraw", { version: n.version });
              }}
            >
              Withdraw notice
            </button>
          )}
        </div>
      )}
      {n.acknowledgementRequired && (
        <section>
          <h4>Read acknowledgement</h4>
          <p>
            Confirming means you have read this revision. It does not mean
            approval or agreement.
          </p>
          {n.acknowledged ? (
            <p role="status">
              Your read acknowledgement is recorded for revision {n.version}.
            </p>
          ) : n.status === "published" && !n.expired ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate("acknowledge", {
                  version: n.version,
                  confirmedRead: confirmed,
                });
              }}
            >
              <label className="checkbox-label">
                <input
                  required
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I confirm I have read revision {n.version}.
              </label>
              <button className="primary" disabled={busy || !confirmed}>
                Confirm read acknowledgement
              </button>
            </form>
          ) : (
            <p>
              Acknowledgement is unavailable for an expired or unpublished
              notice.
            </p>
          )}
        </section>
      )}
      <details>
        <summary>
          {staff
            ? "Read acknowledgement history"
            : "My read acknowledgement history"}
        </summary>
        {!n.acknowledgements.length && (
          <p>No explicit read acknowledgements recorded.</p>
        )}
        <ul>
          {n.acknowledgements.map((a) => (
            <li key={`${a.userId}:${a.version}`}>
              {a.fullName} · revision {a.version} · {formatDate(a.createdAt)}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Notice revision history</summary>
        <ol className="issue-history">
          {n.events.map((e) => (
            <li key={e.id}>
              <p>
                {e.kind} · revision {e.version} · {e.actorName} ·{" "}
                {formatDate(e.createdAt)}
              </p>
              <h4>{e.after.title}</h4>
              <p className="preserve-lines">{e.after.body}</p>
              <p>
                {e.after.status} · {e.after.pinned ? "pinned" : "not pinned"} ·{" "}
                {e.after.acknowledgementRequired
                  ? "read acknowledgement requested"
                  : "no acknowledgement requested"}
              </p>
              <p>
                {e.after.expiresAt
                  ? `Expiry: ${formatDate(e.after.expiresAt)} · Asia/Kolkata`
                  : "No expiry set"}
              </p>
              <Links items={e.after.dataLinks} />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
export function Meetings({
  user,
  initial,
  opened,
}: {
  user: Member;
  initial: Selection | null;
  opened: () => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [notices, setNotices] = useState<Notice[]>([]),
    [people, setPeople] = useState<Person[]>([]);
  const [meetingView, setMeetingView] = useState("upcoming"),
    [noticeView, setNoticeView] = useState("current"),
    [meetingOffset, setMeetingOffset] = useState(0),
    [noticeOffset, setNoticeOffset] = useState(0),
    [moreMeetings, setMoreMeetings] = useState(false),
    [moreNotices, setMoreNotices] = useState(false);
  const [detail, setDetail] = useState<
      | { kind: "meeting"; value: MeetingDetail }
      | { kind: "notice"; value: NoticeDetail }
      | null
    >(null),
    [creating, setCreating] = useState<"meeting" | "notice" | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const staff = meetingManager(user.appRole);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [m, n, p] = await Promise.all([
        api<{ items: Meeting[]; hasMore: boolean }>(
          `/meetings?view=${meetingView}&offset=${meetingOffset}`,
        ),
        api<{ items: Notice[]; hasMore: boolean }>(
          `/notices?view=${noticeView}&offset=${noticeOffset}`,
        ),
        api<Person[]>("/meetings/options"),
      ]);
      setMeetings(m.items);
      setMoreMeetings(m.hasMore);
      setNotices(n.items);
      setMoreNotices(n.hasMore);
      setPeople(p);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [meetingView, noticeView, meetingOffset, noticeOffset]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const open = useCallback(async (s: Selection) => {
    setError("");
    try {
      if (s.kind === "meeting")
        setDetail({
          kind: "meeting",
          value: await api<MeetingDetail>(`/meetings/${s.id}`),
        });
      else
        setDetail({
          kind: "notice",
          value: await api<NoticeDetail>(`/notices/${s.id}`),
        });
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    if (initial) {
      opened();
      void open(initial);
    }
  }, [initial, open, opened]);
  return (
    <section className="collaboration">
      <p>
        Selected-attendee meetings and lab notices · all times Asia/Kolkata.
        Notifications are in-app; no email, push or background reminders.
      </p>
      <ErrorNotice message={error} />
      {error && (
        <button className="secondary" onClick={() => void reload()}>
          Retry meetings and notices
        </button>
      )}
      {staff && (
        <div className="action-row">
          <button className="primary" onClick={() => setCreating("meeting")}>
            New meeting
          </button>
          <button className="secondary" onClick={() => setCreating("notice")}>
            New notice
          </button>
        </div>
      )}
      {loading && <p role="status">Loading meetings and notices…</p>}
      <section>
        <h2>Meetings</h2>
        <label>
          Meeting view
          <select
            value={meetingView}
            onChange={(e) => {
              setMeetingView(e.target.value);
              setMeetingOffset(0);
            }}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All authorized meetings</option>
          </select>
        </label>
        {!meetings.length && !loading && <p>No meetings in this view.</p>}
        <div className="collaboration-grid">
          {meetings.map((m) => (
            <MeetingCard key={m.id} item={m} open={(s) => void open(s)} />
          ))}
        </div>
        <div className="action-row">
          {meetingOffset > 0 && (
            <button
              className="secondary"
              onClick={() => setMeetingOffset((v) => Math.max(0, v - 50))}
            >
              Previous meetings
            </button>
          )}
          {moreMeetings && (
            <button
              className="secondary"
              onClick={() => setMeetingOffset((v) => v + 50)}
            >
              More meetings
            </button>
          )}
        </div>
      </section>
      <section>
        <h2>Notices</h2>
        <label>
          Notice view
          <select
            value={noticeView}
            onChange={(e) => {
              setNoticeView(e.target.value);
              setNoticeOffset(0);
            }}
          >
            <option value="current">Current published</option>
            <option value="expired">Expired</option>
            {staff && (
              <>
                <option value="drafts">Manager drafts</option>
                <option value="withdrawn">Withdrawn</option>
              </>
            )}
            <option value="all">All accessible notices</option>
          </select>
        </label>
        {!notices.length && !loading && <p>No notices in this view.</p>}
        <div className="collaboration-grid">
          {notices.map((n) => (
            <NoticeCard key={n.id} item={n} open={(s) => void open(s)} />
          ))}
        </div>
        <div className="action-row">
          {noticeOffset > 0 && (
            <button
              className="secondary"
              onClick={() => setNoticeOffset((v) => Math.max(0, v - 50))}
            >
              Previous notices
            </button>
          )}
          {moreNotices && (
            <button
              className="secondary"
              onClick={() => setNoticeOffset((v) => v + 50)}
            >
              More notices
            </button>
          )}
        </div>
      </section>
      {creating && (
        <Modal
          title={
            creating === "meeting" ? "Schedule a meeting" : "Draft a notice"
          }
          onClose={() => setCreating(null)}
        >
          <div className="dialog-body">
            {creating === "meeting" ? (
              <MeetingForm
                initial={null}
                people={people}
                cancel={() => setCreating(null)}
                saved={(m) => {
                  setCreating(null);
                  setDetail({ kind: "meeting", value: m });
                  void reload();
                }}
              />
            ) : (
              <NoticeForm
                initial={null}
                cancel={() => setCreating(null)}
                saved={(n) => {
                  setCreating(null);
                  setDetail({ kind: "notice", value: n });
                  void reload();
                }}
              />
            )}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          title={
            detail.kind === "meeting" ? "Meeting details" : "Notice details"
          }
          onClose={() => setDetail(null)}
        >
          <div
            className="dialog-body"
            key={`${detail.kind}:${detail.value.id}`}
          >
            {detail.kind === "meeting" ? (
              <MeetingDetailView
                initial={detail.value}
                user={user}
                people={people}
                changed={() => void reload()}
              />
            ) : (
              <NoticeDetailView
                initial={detail.value}
                user={user}
                changed={() => void reload()}
              />
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
export function MeetingsOverview({ open }: { open: (s: Selection) => void }) {
  const [data, setData] = useState<CollaborationSummary | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(
    () =>
      api<CollaborationSummary>("/collaboration/summary")
        .then(setData)
        .catch((e) => setError(messageOf(e))),
    [],
  );
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 60000);
    return () => clearInterval(timer);
  }, [reload]);
  return (
    <section className="collaboration">
      <h2>Meetings & pinned notices</h2>
      <ErrorNotice message={error} />
      {error && (
        <button className="secondary" onClick={() => void reload()}>
          Retry meeting summary
        </button>
      )}
      {!data ? (
        <p>Loading meeting summary…</p>
      ) : (
        <>
          <div className="collaboration-columns">
            <div>
              <h3>Upcoming meetings</h3>
              {!data.meetings.length && (
                <p>No upcoming meetings in your scope.</p>
              )}
              {data.meetings.map((m) => (
                <MeetingCard key={m.id} item={m} open={open} />
              ))}
            </div>
            <div>
              <h3>Pinned notices</h3>
              {!data.notices.length && <p>No current pinned notices.</p>}
              {data.notices.map((n) => (
                <NoticeCard key={n.id} item={n} open={open} />
              ))}
            </div>
          </div>
          <h3>My meeting actions</h3>
          {!data.actions.length ? (
            <p>No open meeting actions assigned to you.</p>
          ) : (
            <ul>
              {data.actions.map((a) => (
                <li key={a.id}>
                  <button
                    className="text-button"
                    onClick={() => open({ kind: "meeting", id: a.meetingId })}
                  >
                    {a.title}
                  </button>{" "}
                  · due {a.dueDate || "not set"}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
