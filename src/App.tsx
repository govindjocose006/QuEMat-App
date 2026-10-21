import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Instrument, Member, Session } from "../shared/schema.js";
import { api, setSessionToken } from "./api.js";
import { Auth, Onboarding } from "./Auth.js";
import {
  Brand,
  Empty,
  ErrorNotice,
  Icon,
  Status,
  messageOf,
} from "./components.js";
import { InstrumentCard, InstrumentRegister } from "./Instruments.js";
import { AuditLog, Members } from "./Members.js";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const accept = useCallback((value: Session) => {
    setSessionToken(value);
    setSession(value);
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    accept(await api<Session>("/session"));
  }, [accept]);
  useEffect(() => {
    void refresh().catch((e) => setError(messageOf(e)));
    const expired = () => {
      setSession(null);
      void refresh().catch((e) => setError(messageOf(e)));
    };
    window.addEventListener("session-expired", expired);
    const channel = new BroadcastChannel("quemat-session");
    channel.onmessage = (event) => {
      if (event.data === "signed-out") expired();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) expired();
    };
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("pageshow", restored);
      channel.close();
    };
  }, [refresh]);
  useEffect(() => {
    if (!session?.user) return;
    const verify = () => {
      if (document.visibilityState === "visible")
        void refresh().catch((e) => setError(messageOf(e)));
    };
    const timer = window.setInterval(verify, 30_000);
    window.addEventListener("focus", verify);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", verify);
    };
  }, [session?.user?.id, refresh]);
  async function logout() {
    try {
      accept(await api<Session>("/logout", "POST"));
      const channel = new BroadcastChannel("quemat-session");
      channel.postMessage("signed-out");
      channel.close();
    } catch (e) {
      setError(messageOf(e));
    }
  }
  if (!session)
    return (
      <main className="loading-page">
        <Brand />
        <ErrorNotice message={error} />
        {error ? (
          <button
            className="primary"
            onClick={() => {
              setError("");
              void refresh().catch((e) => setError(messageOf(e)));
            }}
          >
            Retry connection
          </button>
        ) : (
          <p role="status">Opening your workspace…</p>
        )}
      </main>
    );
  if (!session.user) return <Auth onSession={accept} />;
  return (
    <>
      {error && (
        <div className="global-error">
          <ErrorNotice message={error} />
        </div>
      )}
      {session.user.status !== "approved" || !session.user.onboarded ? (
        <Onboarding
          key={session.user.id}
          user={session.user}
          onUpdate={refresh}
          onLogout={logout}
        />
      ) : (
        <Workspace
          key={session.user.id}
          user={session.user}
          onLogout={logout}
          refresh={refresh}
          onSession={accept}
        />
      )}
    </>
  );
}
type Page = "overview" | "instruments" | "members" | "audit" | "settings";
const pageLabels = {
  overview: "Overview",
  instruments: "Instruments",
  members: "Members & access",
  audit: "Audit history",
  settings: "My account",
};
function Workspace({
  user,
  onLogout,
  refresh,
  onSession,
}: {
  user: Member;
  onLogout: () => void;
  refresh: () => Promise<void>;
  onSession: (s: Session) => void;
}) {
  const [page, setPage] = useState<Page>("overview");
  const [items, setItems] = useState<Instrument[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");
  const admin = user.appRole === "administrator";
  const reload = useCallback(async () => {
    setError("");
    try {
      setItems(
        await api<Instrument[]>(
          `/instruments${admin && includeArchived ? "?includeArchived=true" : ""}`,
        ),
      );
    } catch (e) {
      setError(messageOf(e));
      throw e;
    }
  }, [admin, includeArchived]);
  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);
  useEffect(() => {
    if (!admin && (page === "members" || page === "audit")) setPage("overview");
  }, [admin, page]);
  const pages: Page[] = admin
    ? ["overview", "instruments", "members", "audit", "settings"]
    : ["overview", "instruments", "settings"];
  const active = items?.filter((i) => !i.archived) ?? [];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand small />
        <div className="workspace-label">LAB WORKSPACE</div>
        <nav aria-label="Main navigation">
          {pages.map((p) => (
            <button
              key={p}
              className={page === p ? "nav-item selected" : "nav-item"}
              aria-current={page === p ? "page" : undefined}
              onClick={() => setPage(p)}
            >
              <Icon name={p} />
              {pageLabels[p]}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="lab-info">
            <span className="lab-dot" /> QuEMat group
            <small>Asia/Kolkata · INR</small>
          </div>
          <a
            href="https://sites.google.com/iisertvm.ac.in/quemat"
            target="_blank"
            rel="noreferrer"
          >
            Group website ↗
          </a>
          <div className="profile">
            <span className="avatar">{user.fullName.slice(0, 1)}</span>
            <div>
              <strong>{user.fullName}</strong>
              <small>{user.appRole}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={onLogout}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="breadcrumb">/</span> {pageLabels[page]}
          </span>
          <span className="private-label">
            <Icon name="lock" /> Members only
          </span>
          <button className="mobile-logout secondary" onClick={onLogout}>
            Sign out
          </button>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">QUEMAT LAB HUB</p>
              <h1>{page === "overview" ? "Lab overview" : pageLabels[page]}</h1>
            </div>
            <div className="today">
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date())}
              <small>Indian Standard Time</small>
            </div>
          </div>
          <ErrorNotice message={error} />
          {error && (
            <button
              className="secondary"
              onClick={() => void reload().catch(() => {})}
            >
              Retry loading instruments
            </button>
          )}
          {page === "overview" && (
            <>
              <div className="welcome-line">
                <div>
                  <h2>Welcome, {user.fullName.split(" ")[0]}.</h2>
                  <p>Your laboratory’s people and instruments, in one place.</p>
                </div>
                <span className="phase-label">Foundation · Phase 1</span>
              </div>
              <div className="stats">
                <div>
                  <span>REGISTERED INSTRUMENTS</span>
                  <strong>
                    {items ? active.length.toString().padStart(2, "0") : "—"}
                  </strong>
                  <small>Shared lab resources</small>
                </div>
                <div>
                  <span>PRIORITY RESOURCES</span>
                  <strong>
                    {items
                      ? active
                          .filter((i) => i.priority)
                          .length.toString()
                          .padStart(2, "0")
                      : "—"}
                  </strong>
                  <small>Magnetometry, furnaces & thin films</small>
                </div>
                <div>
                  <span>REQUIRING ATTENTION</span>
                  <strong>
                    {items
                      ? active
                          .filter((i) => i.status !== "available")
                          .length.toString()
                          .padStart(2, "0")
                      : "—"}
                  </strong>
                  <small>Maintenance or out of service</small>
                </div>
              </div>
              <div className="section-title">
                <div>
                  <h2>Priority instruments</h2>
                  <p>Core resources for the group’s daily work.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setPage("instruments")}
                >
                  View register <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="notice subtle">
                <Icon name="instruments" />
                <span>
                  Operational status is manually maintained and needs lab
                  verification. “Available” is a configuration value, not a live
                  reading or a free booking slot.
                </span>
              </div>
              {items ? (
                active.some((i) => i.priority) ? (
                  <div className="instrument-grid priority-grid">
                    {active
                      .filter((i) => i.priority)
                      .map((i) => (
                        <InstrumentCard key={i.id} instrument={i} />
                      ))}
                  </div>
                ) : (
                  <Empty title="No priority instruments configured">
                    An administrator can add instruments or mark existing ones
                    as priorities.
                  </Empty>
                )
              ) : (
                <p role="status">Loading instruments…</p>
              )}
              <div className="next-phase">
                <div>
                  <p className="eyebrow">NEXT · PHASE 2</p>
                  <h3>Schedules & measurement tracking</h3>
                  <p>
                    Sample records, conflict-protected bookings, and operator
                    check-in will be added in the next phase. No reservations
                    are being tracked yet.
                  </p>
                </div>
                <span aria-hidden="true">↗</span>
              </div>
            </>
          )}
          {page === "instruments" &&
            (items ? (
              <InstrumentRegister
                items={items}
                admin={admin}
                reload={reload}
                includeArchived={includeArchived}
                setIncludeArchived={setIncludeArchived}
              />
            ) : (
              <p role="status">Loading instruments…</p>
            ))}
          {page === "members" && admin && <Members onChanged={refresh} />}
          {page === "audit" && admin && <AuditLog />}
          {page === "settings" && <Account user={user} onSession={onSession} />}
          <footer className="workspace-footer">
            <span>QuEMat · IISER Thiruvananthapuram</span>
            <span>Private laboratory workspace</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Account({
  user,
  onSession,
}: {
  user: Member;
  onSession: (s: Session) => void;
}) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      if (data.get("newPassword") !== data.get("confirm"))
        throw new Error("The new passwords do not match.");
      onSession(
        await api<Session>("/password", "POST", {
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
        }),
      );
      form.reset();
      setSuccess("Password changed. Other sign-in sessions have been revoked.");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-grid">
      <section className="panel">
        <h2>Your membership</h2>
        <Status value={user.status} />
        <dl>
          <dt>Full name</dt>
          <dd>{user.fullName}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Academic role</dt>
          <dd>
            {user.academicRole ?? "Not recorded (administrator bootstrap)"}
          </dd>
          <dt>Application permission</dt>
          <dd>{user.appRole}</dd>
          <dt>Research topic / project</dt>
          <dd>{user.project || "Not recorded"}</dd>
          <dt>Mentor</dt>
          <dd>
            {user.mentorPending
              ? "Assignment pending review"
              : (user.mentorName ?? "Not applicable")}
          </dd>
          <dt>Lab timezone / currency</dt>
          <dd>Asia/Kolkata · INR</dd>
        </dl>
        <p className="field-hint">
          Contact an administrator for membership changes. Academic titles and
          application permissions are separate.
        </p>
      </section>
      <section className="panel">
        <h2>Change password</h2>
        <p>Use a unique passphrase with at least 12 characters.</p>
        <ErrorNotice message={error} />
        {success && (
          <div role="status" className="notice success">
            {success}
          </div>
        )}
        <form onSubmit={submit}>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              name="confirm"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}
