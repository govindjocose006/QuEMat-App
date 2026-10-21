import { useEffect, useState, type FormEvent } from "react";
import type { AuditEntry, Member } from "../shared/schema.js";
import { appRoles, memberStatuses } from "../shared/options.js";
import { api } from "./api.js";
import { MentorField, type MentorOption } from "./Auth.js";
import {
  Empty,
  ErrorNotice,
  Modal,
  Status,
  formatDate,
  messageOf,
} from "./components.js";

export function Members({ onChanged }: { onChanged: () => Promise<void> }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [filter, setFilter] = useState("all");
  async function reload() {
    setError("");
    setLoading(true);
    try {
      setMembers(await api<Member[]>("/admin/members"));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  const filtered = members.filter(
    (m) =>
      filter === "all" ||
      (filter === "mentor-pending" ? m.mentorPending : m.status === filter),
  );
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Members & access</h2>
          <p>Verify membership and assign permissions deliberately.</p>
        </div>
        <button className="secondary" disabled={loading} onClick={reload}>
          Refresh members
        </button>
      </div>
      <div className="notice">
        Before approving an account, verify the person and their email through a
        trusted lab channel. Selecting an academic role never grants elevated
        permissions.
      </div>
      <ErrorNotice message={error} />
      <div className="toolbar">
        <label>
          Show members
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All members</option>
            <option value="pending">Awaiting approval</option>
            <option value="approved">Approved</option>
            <option value="inactive">Inactive</option>
            <option value="mentor-pending">Mentor assignment pending</option>
          </select>
        </label>
        <span className="result-count">
          {members.filter((m) => m.status === "pending").length} awaiting
          approval · {members.filter((m) => m.mentorPending).length} mentor
          assignments pending
        </span>
      </div>
      {loading ? (
        <p role="status">Loading members…</p>
      ) : filtered.length ? (
        <div className="member-list">
          {filtered.map((m) => (
            <article className="member-row" key={m.id}>
              <div className="avatar" aria-hidden="true">
                {(m.fullName || m.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="member-identity">
                <h3>{m.fullName || "Onboarding not completed"}</h3>
                <p>{m.email}</p>
                <small>
                  {m.academicRole ?? "Academic role not recorded"}{" "}
                  {m.project && `· ${m.project}`}
                </small>
                {m.mentorPending && (
                  <p className="warning-text">Mentor assignment pending</p>
                )}
                {m.mentorName && <small>Mentor: {m.mentorName}</small>}
              </div>
              <div className="member-access">
                <Status value={m.status} />
                <small>{m.appRole}</small>
              </div>
              <button
                className="secondary"
                onClick={() => setSelected(m)}
                aria-label={`Manage ${m.fullName || m.email}`}
              >
                Manage
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No members in this view">
          Try a different membership filter.
        </Empty>
      )}
      {selected && (
        <MemberEditor
          user={selected}
          mentors={
            members.filter(
              (m) =>
                m.status === "approved" &&
                (m.academicRole === "PhD student" ||
                  m.academicRole === "Postdoc"),
            ) as MentorOption[]
          }
          onClose={() => setSelected(null)}
          onSaved={async () => {
            await reload();
            await onChanged();
          }}
        />
      )}
    </>
  );
}
function MemberEditor({
  user,
  mentors,
  onClose,
  onSaved,
}: {
  user: Member;
  mentors: MentorOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState(user.status);
  const [role, setRole] = useState(user.appRole);
  const [mentor, setMentor] = useState(user.mentorId ?? "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsMentor =
    user.academicRole === "Intern" || user.academicRole === "Master’s student";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(`/admin/members/${user.id}`, "PATCH", {
        status,
        appRole: role,
        mentorId: needsMentor && mentor !== "pending" ? mentor : null,
        mentorPending: needsMentor && mentor === "pending",
        version: user.version,
        reason: f.get("reason"),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Manage ${user.fullName || "membership"}`} onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <p>
          {user.email} · {user.academicRole ?? "No academic role recorded"}
        </p>
        <ErrorNotice message={error} />
        {!user.onboarded && (
          <div className="notice">
            This account has not completed onboarding and cannot be approved
            yet.
          </div>
        )}
        <label>
          Membership status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Member["status"])}
          >
            {memberStatuses.map((s) => (
              <option key={s} disabled={s === "approved" && !user.onboarded}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Application permission
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Member["appRole"])}
          >
            {appRoles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <p className="field-hint">
          Administrators manage membership and instruments. Mentor and
          supervisor permissions are separate; their progress and operations
          workflows arrive in later phases.
        </p>
        {needsMentor && (
          <MentorField mentors={mentors} value={mentor} onChange={setMentor} />
        )}
        <label>
          Reason for this change
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={500}
            rows={3}
            placeholder="Record identity verification, access authorization, or departure details."
          />
        </label>
        <label className="check">
          <input type="checkbox" required /> I have verified this membership and
          any requested privilege change.
        </label>
        {status === "inactive" && (
          <p className="warning-text">
            Sign-in sessions will be revoked. Historical records are preserved
            and mentees will be flagged for reassignment.
          </p>
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
            {busy ? "Saving…" : "Save membership"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function AuditLog() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      setItems(await api<AuditEntry[]>("/admin/audit"));
    } catch (e) {
      setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Audit history</h2>
          <p>
            The latest 200 events. Full history is retained in the database.
          </p>
        </div>
        <button className="secondary" onClick={load}>
          Refresh history
        </button>
      </div>
      <ErrorNotice message={error} />
      {items ? (
        <div className="audit-list">
          {items.map((item) => (
            <details key={item.id}>
              <summary>
                <span>
                  <strong>
                    {item.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </strong>
                  <small>{item.actorName}</small>
                </span>
                <time>{formatDate(item.createdAt)} IST</time>
              </summary>
              <p className="field-hint">Record: {item.entityId}</p>
              <pre>{JSON.stringify(JSON.parse(item.details), null, 2)}</pre>
            </details>
          ))}
        </div>
      ) : (
        <p role="status">Loading audit history…</p>
      )}
    </>
  );
}
