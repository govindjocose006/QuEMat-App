import { useEffect, useState, type FormEvent } from "react";
import type { Member, Session } from "../shared/schema.js";
import { academicRoles } from "../shared/options.js";
import { api, authenticate } from "./api.js";
import { Brand, ErrorNotice, Icon, messageOf } from "./components.js";
import { MembershipSteps } from "./QuickGuide.js";

export function Auth({ onSession }: { onSession: (session: Session) => void }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const password = String(form.get("password"));
      if (register && password !== form.get("confirm"))
        throw new Error("The passwords do not match.");
      onSession(
        await authenticate(register ? "register" : "login", {
          email: String(form.get("email")).trim(),
          password,
        }),
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-intro">
        <Brand />
        <div>
          <p className="eyebrow">THE QUEMAT GROUP</p>
          <h1>
            A shared space
            <br />
            for our laboratory.
          </h1>
          <p>People, instruments, and the work we do together.</p>
          <div className="auth-rule" />
          <p className="institution">
            IISER Thiruvananthapuram
            <br />
            <span>Supervisor: Dr Deepshikha Jaiswal Nagar</span>
          </p>
        </div>
        <a
          href="https://sites.google.com/iisertvm.ac.in/quemat"
          target="_blank"
          rel="noreferrer"
        >
          Visit the group website ↗
        </a>
      </div>
      <main className="auth-main">
        <div className="auth-card">
          <span className="private-label">
            <Icon name="lock" /> Private lab workspace
          </span>
          <h2>{register ? "Join QuEMat Lab Hub" : "Welcome back"}</h2>
          {register && <MembershipSteps step={1} />}
          <p>
            {register
              ? "Create an account, introduce yourself, and request membership approval."
              : "Sign in to your laboratory workspace."}
          </p>
          <ErrorNotice message={error} />
          <form onSubmit={submit}>
            <label>
              Email
              <input
                required
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                required
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {register && (
              <>
                <small className="field-hint">
                  Use 12–128 characters. A unique passphrase is a good choice.
                </small>
                <label>
                  Confirm password
                  <input
                    required
                    name="confirm"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="switch-auth">
            {register ? "Already a member?" : "New to the group?"}{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Request access"}
            </button>
          </p>
          <p className="privacy-note">
            {register
              ? "Registration does not grant access to lab records. An administrator verifies and approves membership."
              : "Need a password reset? Contact your lab administrator for identity verification and a secure reset."}
          </p>
        </div>
        <div className="auth-footer">QuEMat · Private laboratory workspace</div>
      </main>
    </div>
  );
}
export type MentorOption = {
  id: string;
  fullName: string;
  academicRole: string;
};
export function MentorField({
  mentors,
  value,
  onChange,
}: {
  mentors: MentorOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      Supervising PhD student or Postdoc
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="pending">Mentor assignment pending</option>
        {mentors.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName} · {m.academicRole}
          </option>
        ))}
      </select>
      <small className="field-hint">
        If your mentor has not joined, an administrator will review the pending
        assignment.
      </small>
    </label>
  );
}
export function Onboarding({
  user,
  onUpdate,
  onLogout,
}: {
  user: Member;
  onUpdate: () => Promise<void>;
  onLogout: () => void;
}) {
  const [editing, setEditing] = useState(!user.onboarded);
  const [role, setRole] = useState<string>(user.academicRole ?? "PhD student");
  const [mentor, setMentor] = useState(user.mentorId ?? "pending");
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<MentorOption[]>("/mentors")
      .then(setMentors)
      .catch((e) => setError(messageOf(e)));
  }, []);
  const needsMentor = role === "Intern" || role === "Master’s student";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/onboarding", "PUT", {
        fullName: form.get("fullName"),
        academicRole: role,
        project: form.get("project"),
        mentorId: needsMentor && mentor !== "pending" ? mentor : null,
        mentorPending: needsMentor && mentor === "pending",
      });
      await onUpdate();
      setEditing(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="onboarding-page">
      <header>
        <Brand />
        <button className="secondary" onClick={onLogout}>
          Sign out
        </button>
      </header>
      <main className="onboarding-card">
        <MembershipSteps step={editing ? 2 : 3} />
        <p className="eyebrow">
          MEMBERSHIP · {editing ? "YOUR PROFILE" : "UNDER REVIEW"}
        </p>
        <h1>
          {editing
            ? "Introduce yourself"
            : "Your request is with the administrator"}
        </h1>
        <p>
          {editing
            ? "A few details help us connect you with the right people."
            : "Your profile is saved. Lab records become available after your identity and membership are approved."}
        </p>
        <ErrorNotice message={error} />
        {editing ? (
          <form onSubmit={submit}>
            <label>
              Full name
              <input
                name="fullName"
                defaultValue={user.fullName}
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label>
              Email
              <input value={user.email} readOnly />
            </label>
            <label>
              Academic role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {academicRoles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              Academic role describes your position. It does not grant
              supervisor or administrator permissions.
            </p>
            <label>
              Research topic / project{" "}
              <span className="optional">(optional)</span>
              <textarea
                name="project"
                defaultValue={user.project}
                maxLength={500}
                rows={3}
              />
            </label>
            {needsMentor && (
              <MentorField
                mentors={mentors}
                value={mentor}
                onChange={setMentor}
              />
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Submit for approval"}
            </button>
          </form>
        ) : (
          <>
            <p className="guide-note">
              Next: ask a lab administrator to review your request, then use
              Check approval status below. After approval, Overview will show
              starting points and a Quick Guide.
            </p>
            <div className="review-summary">
              <Icon name="lock" />
              <div>
                <strong>{user.fullName}</strong>
                <p>
                  {user.academicRole} · {user.email}
                </p>
                {user.mentorPending && (
                  <p className="warning-text">
                    Mentor assignment pending administrator review.
                  </p>
                )}
              </div>
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onUpdate();
                  } catch (e) {
                    setError(messageOf(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Checking…" : "Check approval status"}
              </button>
              <button className="secondary" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
