import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Instrument, Member } from "../shared/schema.js";
import type { MonitoringSnapshot } from "../shared/scheduling.js";
import { issueStatusLabels, type IssueSummary } from "../shared/issues.js";
import { fromIST, istInput } from "../shared/scheduling-ui.js";
import { weekLabel } from "../shared/weekly.js";
import { api } from "./api.js";
import { ErrorNotice, Icon, formatDate, messageOf } from "./components.js";
import { IssuesOverview } from "./Issues.js";
import { LiveUsage } from "./Scheduling.js";
import { MeetingsOverview } from "./Meetings.js";
import { OrdersOverview } from "./Orders.js";
import type { Page } from "./navigation.js";

type WeeklySummary = {
  week: string;
  mine: string;
  openActions: number;
  review: { submitted: number; missing: number; awaitingReview: number } | null;
};
// Independent panels stay usable when another endpoint fails. Invalidate reads
// on unmount and refresh, and avoid overlapping automatic refreshes.
function useOverviewData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0),
    pending = useRef(false);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    pending.current = true;
    setLoading(true);
    try {
      const value = await api<T>(path);
      if (request === generation.current) {
        setData(value);
        setError("");
      }
    } catch (e) {
      if (request === generation.current) setError(messageOf(e));
    } finally {
      if (request === generation.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, [path]);
  useEffect(() => {
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current)
        void reload();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      generation.current++;
      pending.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  return { data, error, loading, reload };
}
function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: "calendar" | "issues" | "weekly" | "instruments";
  children: ReactNode;
}) {
  return (
    <section className="focus-card">
      <div className="focus-card-heading">
        <span className="focus-icon">
          <Icon name={icon} />
        </span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function ReadState({
  resource,
  label,
}: {
  resource: {
    data: unknown;
    error: string;
    loading: boolean;
    reload: () => Promise<void>;
  };
  label: string;
}) {
  if (resource.error)
    return (
      <div className="focus-read-state">
        <ErrorNotice message={resource.error} />
        <button
          className="secondary"
          disabled={resource.loading}
          onClick={() => void resource.reload()}
        >
          Retry {label}
        </button>
      </div>
    );
  return !resource.data ? (
    <div className="focus-loading" role="status">
      <p>Loading {label}…</p>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  ) : null;
}
function Disclosure({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="overview-disclosure"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
        <span className="disclosure-cue" aria-hidden="true">
          {open ? "Hide" : "Explore"}
          <Icon name="arrow" />
        </span>
      </summary>
      {open && <div className="overview-disclosure-body">{children}</div>}
    </details>
  );
}
export function Overview({
  user,
  onNavigate,
  onIssue,
  onWeekly,
  onCollaboration,
  onInstruments,
}: {
  user: Member;
  onNavigate: (page: Page) => void;
  onIssue: (id: string) => void;
  onWeekly: (review: boolean) => void;
  onCollaboration: (selection: {
    kind: "meeting" | "notice";
    id: string;
  }) => void;
  onInstruments: (items: Instrument[]) => void;
}) {
  const monitoring = useOverviewData<MonitoringSnapshot>("/monitoring");
  const issues = useOverviewData<IssueSummary>("/issues/summary");
  const weekly = useOverviewData<WeeklySummary>("/weekly/summary");
  const supervisor = user.appRole === "supervisor";
  useEffect(() => {
    if (monitoring.data) onInstruments(monitoring.data.instruments);
  }, [monitoring.data, onInstruments]);
  const snapshot = monitoring.data;
  const date = istInput(
    snapshot?.refreshedAt ?? new Date().toISOString(),
  ).slice(0, 10);
  const start = Date.parse(fromIST(date + "T00:00"));
  const end = start + 86400000;
  const reservations =
    snapshot?.bookings.filter(
      (b) =>
        (b.operatorId === user.id || b.bookedBy === user.id) &&
        ["requested", "confirmed", "in_progress"].includes(b.status) &&
        (b.status === "in_progress" ||
          (Date.parse(b.startsAt) < end && Date.parse(b.endsAt) > start)),
    ) ?? [];
  const instruments = snapshot?.instruments.filter((i) => !i.archived) ?? [];
  const unavailable = instruments.filter(
    (i) => i.status !== "available",
  ).length;
  const running = new Set(
    snapshot?.bookings
      .filter(
        (b) =>
          b.status === "in_progress" &&
          instruments.some((i) => i.id === b.instrumentId),
      )
      .map((b) => b.instrumentId),
  ).size;
  const key = supervisor ? "supervisor" : "assigned";
  const attention = issues.data?.[key] ?? [];
  const reservationCard = (
    <Panel title="Today’s reservations" icon="calendar">
      <ReadState resource={monitoring} label="reservations" />
      {snapshot && !monitoring.error && (
        <>
          <p className="focus-caption">Your bookings and runs · Asia/Kolkata</p>
          {reservations.length ? (
            <ul className="focus-list">
              {reservations.slice(0, 3).map((b) => (
                <li key={b.id}>
                  <strong>{b.instrumentName}</strong>
                  <span>{b.measurementType}</span>
                  <span>
                    {formatDate(b.startsAt)} – {formatDate(b.endsAt)}
                  </span>
                  <span
                    className={
                      b.status === "in_progress"
                        ? "focus-label active"
                        : "focus-label"
                    }
                  >
                    {b.status === "in_progress"
                      ? "Checked in"
                      : b.status === "requested"
                        ? "Awaiting approval"
                        : "Reserved · check-in required"}
                  </span>
                  {b.status === "in_progress" &&
                    Date.parse(b.endsAt) < Date.parse(snapshot.refreshedAt) && (
                      <span className="focus-warning">
                        Past scheduled end · completion needed
                      </span>
                    )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="focus-empty">
              No reservations for you today. Use the calendar to plan your next
              measurement.
            </p>
          )}
          {reservations.length > 3 && (
            <p className="focus-caption">
              Showing 3 of {reservations.length}. View the calendar for all
              reservations.
            </p>
          )}
        </>
      )}
      <button
        className="text-button focus-link"
        onClick={() => onNavigate("calendar")}
      >
        View calendar <Icon name="arrow" />
      </button>
    </Panel>
  );
  return (
    <div className="focused-overview">
      <div className="focus-intro">
        <div>
          <p className="eyebrow">
            {supervisor ? "SUPERVISOR OVERVIEW" : "MY DAY"}
          </p>
          <p className="focus-lead">
            {supervisor
              ? "Decisions first. The whole lab within reach."
              : "Your next steps, all in one place."}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => (supervisor ? onWeekly(true) : onNavigate("calendar"))}
        >
          <Icon name={supervisor ? "weekly" : "calendar"} />
          {supervisor ? "Review reports" : "Open calendar"}
        </button>
      </div>
      <div className="focus-grid">
        {!supervisor && reservationCard}
        <Panel
          title={supervisor ? "Needs your attention" : "Assigned to you"}
          icon="issues"
        >
          <ReadState resource={issues} label="assigned work" />
          {issues.data && !issues.error && (
            <>
              <p className="focus-caption">
                {supervisor
                  ? "Supervisor attention requested"
                  : "Open issues you are handling"}
              </p>
              <p className="focus-number">
                {issues.data.counts[key]}
                <span>
                  {supervisor ? "escalated issues" : "assigned issues"}
                </span>
              </p>
              {attention.length ? (
                <ul className="focus-list">
                  {attention.slice(0, 3).map((i) => (
                    <li key={i.id}>
                      <button
                        className="text-button"
                        onClick={() => onIssue(i.id)}
                      >
                        {i.code} · {i.title}
                      </button>
                      <span>
                        {issueStatusLabels[i.status]}
                        {i.dueDate ? ` · Due ${i.dueDate}` : ""}
                      </span>
                      {supervisor && (
                        <span>
                          {i.assigneeName
                            ? `Handled by ${i.assigneeName}`
                            : "No handler assigned"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="focus-empty">
                  {supervisor
                    ? "No issues currently request your attention. Routine work is available in Lab activity below."
                    : "No issues assigned to you. Meeting actions are available below."}
                </p>
              )}
              {issues.data.counts[key] > 3 && (
                <p className="focus-caption">
                  Showing the 3 most recently updated. Open issues for the full
                  list.
                </p>
              )}
            </>
          )}
          <button
            className="text-button focus-link"
            onClick={() => onNavigate("issues")}
          >
            Open issues & requests <Icon name="arrow" />
          </button>
        </Panel>
        <Panel
          title={supervisor ? "Weekly reports" : "My weekly report"}
          icon="weekly"
        >
          <ReadState resource={weekly} label="weekly progress" />
          {weekly.data && !weekly.error && (
            <>
              <p className="focus-caption">{weekLabel(weekly.data.week)}</p>
              {supervisor && weekly.data.review ? (
                <>
                  <p className="focus-number">
                    {weekly.data.review.awaitingReview}
                    <span>awaiting your review</span>
                  </p>
                  <p className="focus-caption">
                    {weekly.data.review.submitted} submitted ·{" "}
                    {weekly.data.review.missing} not yet submitted
                  </p>
                  <p className="focus-empty">
                    Open reports to read progress and leave feedback.
                  </p>
                </>
              ) : (
                <>
                  <p className="focus-report-state">{weekly.data.mine}</p>
                  <p>
                    {weekly.data.openActions
                      ? `${weekly.data.openActions} open report follow-ups`
                      : "No open report follow-ups."}
                  </p>
                  <p className="focus-privacy">
                    <Icon name="lock" />
                    Drafts are private to you. Submitted reports are shared only
                    with the supervisor.
                  </p>
                </>
              )}
            </>
          )}
          <button
            className="text-button focus-link"
            onClick={() => onWeekly(supervisor)}
          >
            {supervisor ? "View weekly progress" : "Open Weekly Progress"}
            <Icon name="arrow" />
          </button>
        </Panel>
        {supervisor && (
          <Panel title="Lab status" icon="instruments">
            <ReadState resource={monitoring} label="lab status" />
            {snapshot && !monitoring.error && (
              <>
                <p className="focus-caption">
                  Confirmed usage and instrument status
                </p>
                <dl className="focus-stats">
                  <div>
                    <dt>In use</dt>
                    <dd>{running}</dd>
                  </div>
                  <div>
                    <dt>Maintenance / out of service</dt>
                    <dd>{unavailable}</dd>
                  </div>
                  <div>
                    <dt>Registered instruments</dt>
                    <dd>{instruments.length}</dd>
                  </div>
                </dl>
                <p className="focus-caption">
                  Open Lab activity below for reservations, handovers and
                  routine issues.
                </p>
              </>
            )}
            <button
              className="text-button focus-link"
              onClick={() => onNavigate("instruments")}
            >
              Open instruments <Icon name="arrow" />
            </button>
          </Panel>
        )}
      </div>
      <p className="focus-update">
        {snapshot
          ? `Usage last checked ${formatDate(snapshot.refreshedAt)} · IST`
          : "Checking the lab…"}
      </p>
      <div className="overview-explore">
        <Disclosure
          title="Meetings, notices & action items"
          hint="Upcoming meetings, pinned notices and your meeting actions"
        >
          <MeetingsOverview open={onCollaboration} />
          <button className="secondary" onClick={() => onNavigate("meetings")}>
            View all meetings & notices
          </button>
        </Disclosure>
        <Disclosure
          title="Lab activity"
          hint={
            issues.data && !issues.error
              ? `${issues.data.counts.urgent} urgent unresolved issues · instrument activity, handovers and orders`
              : "Instrument activity, handovers, issues and orders"
          }
        >
          <div className="overview-layout">
            <LiveUsage
              user={user}
              onCalendar={() => onNavigate("calendar")}
              snapshot={snapshot}
              error={monitoring.error}
              reload={() => void monitoring.reload()}
            />
            <div className="overview-rail">
              <IssuesOverview user={user} onOpen={onIssue} />
              <OrdersOverview open={() => onNavigate("orders")} />
            </div>
          </div>
        </Disclosure>
        {supervisor && (
          <Disclosure
            title="My reservations"
            hint="Your own bookings and runs for today"
          >
            {reservationCard}
          </Disclosure>
        )}
      </div>
    </div>
  );
}
