import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Instrument, Member, Session } from "../shared/schema.js";
import { api, setSessionToken } from "./api.js";
import { pageLabels, useWorkspaceNavigation, type Page } from "./navigation.js";
import { Schedule, Samples, LiveUsage, Notifications } from "./Scheduling.js";
import { Auth, Onboarding } from "./Auth.js";
import {
  Brand,
  Empty,
  ErrorNotice,
  Icon,
  Status,
  messageOf,
} from "./components.js";
import { InstrumentRegister } from "./Instruments.js";
import { AuditLog, Members } from "./Members.js";
import { Orders, OrdersOverview } from "./Orders.js";
import { Issues, IssuesOverview } from "./Issues.js";
import { Meetings, MeetingsOverview } from "./Meetings.js";
import { Weekly, WeeklyOverview } from "./Weekly.js";

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
  const [page, setPage] = useWorkspaceNavigation(
    user.appRole === "administrator",
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const unreadGeneration = useRef(0);
  const refreshUnread = useCallback(async () => {
    const request = ++unreadGeneration.current;
    try {
      const data = await api<{ unreadCount: number }>("/notifications/summary");
      if (request === unreadGeneration.current)
        setUnreadCount(data.unreadCount);
    } catch {
      /* Retain the last confirmed count during transient outages. */
    }
  }, []);
  useEffect(() => {
    void refreshUnread();
    const visible = () => {
      if (document.visibilityState === "visible") void refreshUnread();
    };
    const timer = setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      unreadGeneration.current++;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshUnread]);
  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [page]);
  const [collaboration, setCollaboration] = useState<{
    kind: "meeting" | "notice";
    id: string;
  } | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const openedOrder = useCallback(() => setOrderId(null), []);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [weeklyId, setWeeklyId] = useState<string | null>(null);
  const [items, setItems] = useState<Instrument[] | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");
  const admin = user.appRole === "administrator";
  const instrumentGeneration = useRef(0);
  const acceptInstruments = useCallback((data: Instrument[]) => {
    instrumentGeneration.current++;
    setItems(data);
    setError("");
  }, []);
  const reload = useCallback(async () => {
    const request = ++instrumentGeneration.current;
    try {
      const data = await api<Instrument[]>(
        `/instruments${admin && includeArchived ? "?includeArchived=true" : ""}`,
      );
      if (request === instrumentGeneration.current) {
        setItems(data);
        setError("");
      }
    } catch (e) {
      if (request === instrumentGeneration.current) setError(messageOf(e));
      throw e;
    }
  }, [admin, includeArchived]);
  useEffect(() => {
    if (page !== "instruments" && page !== "calendar") return;
    void reload().catch(() => {});
    const visible = () => {
      if (document.visibilityState === "visible") void reload().catch(() => {});
    };
    const timer = setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", visible);
    };
  }, [reload, page]);
  useEffect(() => {
    if (!admin && (page === "members" || page === "audit")) setPage("overview");
  }, [admin, page]);
  const pages: Page[] = admin
    ? [
        "overview",
        "calendar",
        "samples",
        "weekly",
        "orders",
        "issues",
        "meetings",
        "notifications",
        "instruments",
        "members",
        "audit",
        "settings",
      ]
    : [
        "overview",
        "calendar",
        "samples",
        "weekly",
        "orders",
        "issues",
        "meetings",
        "notifications",
        "instruments",
        "settings",
      ];
  const active = items?.filter((i) => !i.archived) ?? [];
  const primaryPages: Page[] = ["overview", "calendar", "notifications"];
  const badge =
    unreadCount !== null && unreadCount > 0 ? (
      <span className="unread-badge" aria-hidden="true">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    ) : null;
  const navigate = (p: Page) => {
    setPage(p);
    setMoreOpen(false);
    if (p === page) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  };
  const navButton = (p: Page) => (
    <button
      key={p}
      className={page === p ? "nav-item selected" : "nav-item"}
      aria-current={page === p ? "page" : undefined}
      aria-describedby={
        p === "notifications" ? "unread-notification-status" : undefined
      }
      onClick={() => navigate(p)}
    >
      <Icon name={p} />
      <span>{pageLabels[p]}</span>
      {p === "notifications" && badge}
    </button>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand small />
        <div className="workspace-label">LAB WORKSPACE</div>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {pages.map(navButton)}
        </nav>
        <nav className="mobile-navigation" aria-label="Main navigation">
          <div className="mobile-primary">
            {primaryPages.map(navButton)}
            <button
              className={`nav-item more-toggle${!primaryPages.includes(page) ? " selected" : ""}`}
              aria-expanded={moreOpen}
              aria-controls="mobile-more-navigation"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span aria-hidden="true">⋯</span>
              <span>More</span>
            </button>
          </div>
          <div
            className="mobile-more-panel"
            id="mobile-more-navigation"
            hidden={!moreOpen}
          >
            {pages.filter((p) => !primaryPages.includes(p)).map(navButton)}
          </div>
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
          <span
            id="unread-notification-status"
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {unreadCount === null
              ? "Unread count not yet available"
              : `${unreadCount} unread notifications at last check`}
          </span>
          <button
            className="secondary inbox-button"
            aria-label="Open inbox"
            aria-describedby="unread-notification-status"
            onClick={() => navigate("notifications")}
          >
            <Icon name="notifications" />
            <span>Inbox</span>
            {badge}
          </button>
          <button className="workspace-logout secondary" onClick={onLogout}>
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
                <span className="phase-label">Lab operations</span>
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
              <LiveUsage
                user={user}
                onCalendar={() => setPage("calendar")}
                onInstruments={acceptInstruments}
              />
              <OrdersOverview
                open={() => {
                  setOrderId(null);
                  setPage("orders");
                }}
              />
              <IssuesOverview
                user={user}
                onOpen={(id) => {
                  setIssueId(id);
                  setPage("issues");
                }}
              />
              <MeetingsOverview
                open={(selection) => {
                  setCollaboration(selection);
                  setPage("meetings");
                }}
              />
              <WeeklyOverview
                onOpen={() => {
                  setWeeklyId(null);
                  setPage("weekly");
                }}
              />
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
          {page === "calendar" && items && (
            <Schedule user={user} items={items} />
          )}
          {page === "samples" && <Samples user={user} />}
          {page === "orders" && (
            <Orders user={user} initialId={orderId} onOpened={openedOrder} />
          )}
          {page === "issues" && (
            <Issues
              user={user}
              initialId={issueId}
              onInitialOpened={() => setIssueId(null)}
            />
          )}
          {page === "meetings" && (
            <Meetings
              user={user}
              initial={collaboration}
              opened={() => setCollaboration(null)}
            />
          )}
          {page === "weekly" && <Weekly user={user} initialId={weeklyId} />}
          {page === "notifications" && (
            <Notifications
              onOrder={(id) => {
                setOrderId(id);
                setPage("orders");
              }}
              onRead={() => void refreshUnread()}
              onMeeting={(id) => {
                setCollaboration({ kind: "meeting", id });
                setPage("meetings");
              }}
              onNotice={(id) => {
                setCollaboration({ kind: "notice", id });
                setPage("meetings");
              }}
              onIssue={(id) => {
                setIssueId(id);
                setPage("issues");
              }}
              onWeekly={(id) => {
                setWeeklyId(id);
                setPage("weekly");
              }}
            />
          )}
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
