import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Member } from "../shared/schema.js";
import {
  canOpenReview,
  emptyReport,
  reportFields,
  weekLabel,
  weekStart,
  type ReportInput,
  type ReportContent,
  type WeeklyReport,
  type WeeklyRoster,
  type WeeklyBooking,
  type WeeklySample,
} from "../shared/weekly.js";
import { api } from "./api.js";
import { ErrorNotice, Modal, formatDate, messageOf } from "./components.js";

function Content({ content: c }: { content: ReportContent }) {
  return (
    <div className="weekly-content">
      <p>
        <strong>Project:</strong> {c.project || "Not specified"}
      </p>
      {Object.entries(reportFields).map(([key, label]) => (
        <section key={key}>
          <h3>{label}</h3>
          <p className="preserve-lines">
            {c[key as keyof typeof reportFields] || "—"}
          </p>
        </section>
      ))}
      <h3>Selected samples</h3>
      {!c.samples.length && <p>No samples linked.</p>}
      {c.samples.map((s) => (
        <p key={s.id}>
          <strong>{s.code}</strong> · {s.compound} · {s.batch || "No batch"}
          {s.archived ? " · Archived" : ""}
        </p>
      ))}
      <h3>Selected bookings</h3>
      {!c.bookings.length && <p>No bookings linked.</p>}
      {c.bookings.map((b) => (
        <article className="weekly-linked" key={b.id}>
          <strong>
            {b.instrumentName} · {b.measurementType}
          </strong>
          <p>
            Operator: {b.operatorName} · Status: {b.status}
          </p>
          <p>
            Scheduled: {formatDate(b.startsAt)} – {formatDate(b.endsAt)}
          </p>
          <p>
            {b.actualStart
              ? `Actual check-in: ${formatDate(b.actualStart)} · ${b.actualEnd ? `Ended: ${formatDate(b.actualEnd)}` : "End not recorded"}`
              : "Scheduled booking only; actual use has not been recorded."}
          </p>
          <p>
            Samples:{" "}
            {b.sampleSnapshots
              .map((s) => `${s.code} ${s.compound}`)
              .join(", ") || "None"}
          </p>
          {b.completionSummary && (
            <p className="preserve-lines">
              Recorded outcome: {b.completionSummary}
            </p>
          )}
          {b.dataLink && (
            <a href={b.dataLink} target="_blank" rel="noreferrer">
              Booking data link
            </a>
          )}
        </article>
      ))}
      <h3>Data links</h3>
      {!c.dataLinks.length && <p>No data links.</p>}
      {c.dataLinks.map((l, i) => (
        <p key={i}>
          <a href={l.url} target="_blank" rel="noreferrer">
            {l.label}
          </a>
          <span className="print-url"> — {l.url}</span>
        </p>
      ))}
    </div>
  );
}

export function WeeklyDetail({
  id,
  user,
  onChanged,
}: {
  id: string;
  user: Member;
  onChanged?: () => void;
}) {
  const [report, setReport] = useState<WeeklyReport | null>(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState("comment");
  const load = useCallback(
    () =>
      api<WeeklyReport>(`/weekly/reports/${id}`)
        .then((r) => {
          setReport(r);
          setRevision(r.latestRevision);
        })
        .catch((e) => setError(messageOf(e))),
    [id],
  );
  useEffect(() => {
    setReport(null);
    setError("");
    void load();
  }, [load]);
  async function write(path: string, data: unknown) {
    setBusy(true);
    setError("");
    try {
      setReport(
        await api<WeeklyReport>(`/weekly/reports/${id}/${path}`, "POST", data),
      );
      onChanged?.();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function comment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    if (
      await write("comments", {
        revision,
        kind,
        body: String(f.get("body")),
        dueDate:
          kind === "followup" ? String(f.get("dueDate") || "") || null : null,
      })
    )
      form.reset();
  }
  const snapshot = report?.revisions.find((r) => r.revision === revision);
  return (
    <div>
      <ErrorNotice message={error} />
      {!report && !error && <p role="status">Loading report…</p>}
      {report && (
        <>
          <h2>{report.ownerName}</h2>
          <p>{weekLabel(report.week)}</p>
          <p>
            First submitted:{" "}
            {report.firstSubmittedAt
              ? formatDate(report.firstSubmittedAt)
              : "Not submitted"}
          </p>
          {report.revisions.length > 0 && (
            <label>
              Submitted revision
              <select
                value={revision}
                onChange={(e) => setRevision(Number(e.target.value))}
              >
                {report.revisions.map((r) => (
                  <option key={r.revision} value={r.revision}>
                    Revision {r.revision} · {formatDate(r.submittedAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {snapshot && (
            <>
              <p>
                Submitted: {formatDate(snapshot.submittedAt)} · Immutable
                revision {revision}
              </p>
              <Content content={snapshot.content} />
            </>
          )}
          {!snapshot && (
            <p>
              This report has no submitted version yet. Draft content is private
              to its author.
            </p>
          )}
          {snapshot && (
            <>
              <h3>Review history</h3>
              {report.reviews
                .filter((r) => r.revision === revision)
                .map((r, i) => (
                  <p key={i}>
                    {r.reviewerName} reviewed revision {r.revision} ·{" "}
                    {formatDate(r.reviewedAt)}
                  </p>
                ))}
              {report.canReview && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void write("review", { revision })}
                >
                  Mark revision {revision} reviewed
                </button>
              )}
              <h3>Comments and report follow-ups</h3>
              {report.comments.map((c) => (
                <article className="weekly-linked" key={c.id}>
                  <strong>
                    {c.authorName} · revision {c.revision} ·{" "}
                    {c.kind === "followup"
                      ? `Follow-up: ${c.state}`
                      : "Comment"}
                  </strong>
                  <p>
                    {formatDate(c.createdAt)}
                    {c.dueDate ? ` · Due ${c.dueDate} (Asia/Kolkata)` : ""}
                  </p>
                  <p className="preserve-lines">{c.body}</p>
                  {c.kind === "followup" && (
                    <>
                      <p>Owner: {report.ownerName}</p>
                      {(report.canReview || report.ownerId === user.id) && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void write(`actions/${c.id}`, {
                              version: c.version,
                              state: c.state === "open" ? "done" : "open",
                            })
                          }
                        >
                          {c.state === "open"
                            ? "Complete follow-up"
                            : "Reopen follow-up"}
                        </button>
                      )}
                      <details>
                        <summary>Action history</summary>
                        {report.actionEvents
                          .filter((e) => e.commentId === c.id)
                          .map((e, i) => (
                            <p key={i}>
                              {e.actorName}: {e.state} ·{" "}
                              {formatDate(e.createdAt)}
                            </p>
                          ))}
                      </details>
                    </>
                  )}
                </article>
              ))}
              <form onSubmit={comment} className="weekly-comment">
                <label>
                  Comment type
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="comment">Comment / reply</option>
                    {report.canReview && (
                      <option value="followup">
                        Follow-up for report author
                      </option>
                    )}
                  </select>
                </label>
                <label>
                  Comment or follow-up
                  <textarea name="body" required maxLength={4000} />
                </label>
                {kind === "followup" && (
                  <label>
                    Follow-up due date (optional)
                    <input name="dueDate" type="date" />
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  Add {kind === "followup" ? "follow-up" : "comment"}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ReportEditor({
  user,
  week,
  onUpdate,
}: {
  user: Member;
  week: string;
  onUpdate: () => void;
}) {
  const [report, setReport] = useState<WeeklyReport | null>(null),
    [draft, setDraft] = useState<ReportInput>({
      ...emptyReport,
      project: user.project,
    }),
    [sources, setSources] = useState<{
      bookings: WeeklyBooking[];
      samples: WeeklySample[];
    }>({ bookings: [], samples: [] }),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState<{
      version: number;
      content: ReportContent;
      reviewDigest: string;
    } | null>(null),
    [history, setHistory] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setLoaded(false);
    Promise.all([
      api<WeeklyReport | null>(`/weekly/mine?week=${week}`),
      api<typeof sources>(`/weekly/sources?week=${week}`),
    ])
      .then(([r, s]) => {
        if (!live) return;
        setReport(r);
        setDraft(r?.draft ?? { ...emptyReport, project: user.project });
        setSources(s);
        setDirty(false);
        setLoaded(true);
      })
      .catch((e) => {
        if (live) setError(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [week, user.project]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change<K extends keyof ReportInput>(key: K, value: ReportInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setNotice("");
  }
  function toggle(
    key: "sampleIds" | "bookingIds",
    id: string,
    checked: boolean,
  ) {
    change(
      key,
      checked ? [...draft[key], id] : draft[key].filter((x) => x !== id),
    );
  }
  async function save(review = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<WeeklyReport>(
        report ? `/weekly/reports/${report.id}` : "/weekly/reports",
        report ? "PUT" : "POST",
        report
          ? { version: report.version, content: draft }
          : { week, content: draft },
      );
      setReport(r);
      setDirty(false);
      setNotice("Draft saved privately.");
      onUpdate();
      if (review)
        setPreview(
          await api(`/weekly/reports/${r.id}/preview`, "POST", {
            version: r.version,
          }),
        );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!report || !preview) return;
    setBusy(true);
    setError("");
    try {
      setReport(
        await api<WeeklyReport>(`/weekly/reports/${report.id}/submit`, "POST", {
          version: preview.version,
          reviewDigest: preview.reviewDigest,
        }),
      );
      setPreview(null);
      setNotice("Report submitted. Its timestamp and revision are preserved.");
      onUpdate();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  if (!loaded)
    return (
      <>
        <ErrorNotice message={error} />
        {!error && <p role="status">Loading your report…</p>}
      </>
    );
  return (
    <section className="panel weekly-editor">
      <h2>My report</h2>
      <p>{weekLabel(week)}</p>
      <p>
        {report?.latestRevision
          ? `Submitted revision ${report.latestRevision}${report.hasDraft ? " · Revision draft saved" : ""}`
          : "Not submitted"}{" "}
        · {dirty ? "Unsaved changes" : "Saved state"}
      </p>
      <p>
        Save drafts before leaving this page. A saved revision draft does not
        replace your last submission until you review and submit it.
      </p>
      <ErrorNotice message={error} />
      {notice && <p role="status">{notice}</p>}
      {preview ? (
        <form onSubmit={submit}>
          <h2>Review before submitting</h2>
          <Content content={preview.content} />
          <label className="check-row">
            <input type="checkbox" required />I have reviewed this report and
            its selected records.
          </label>
          <div className="action-row">
            <button
              className="secondary"
              type="button"
              onClick={() => setPreview(null)}
              disabled={busy}
            >
              Back to editing
            </button>
            <button className="primary" disabled={busy}>
              Confirm submission
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <fieldset className="weekly-draft-fields" disabled={busy}>
            <legend className="sr-only">Weekly draft</legend>
            <label>
              Report project
              <input
                value={draft.project}
                maxLength={500}
                onChange={(e) => change("project", e.target.value)}
              />
            </label>
            <div className="form-grid">
              {Object.entries(reportFields).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    value={draft[key as keyof typeof reportFields]}
                    maxLength={6000}
                    onChange={(e) =>
                      change(key as keyof typeof reportFields, e.target.value)
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              Complete all six sections to submit. Write “None” where
              appropriate. Booking records describe activity; they do not
              measure research quality.
            </p>
            <fieldset>
              <legend>Include relevant bookings from this week</legend>
              <p>
                Only bookings you booked, operated or participated in are
                offered. Selecting a scheduled booking does not claim it was
                measured.
              </p>
              {!sources.bookings.length && (
                <p>No relevant bookings for this week.</p>
              )}
              {sources.bookings.map((b) => (
                <label className="check-row" key={b.id}>
                  <input
                    type="checkbox"
                    checked={draft.bookingIds.includes(b.id)}
                    onChange={(e) =>
                      toggle("bookingIds", b.id, e.target.checked)
                    }
                  />
                  <span>
                    {b.instrumentName} · {b.measurementType} ·{" "}
                    {formatDate(b.startsAt)} · {b.status}
                    {b.actualStart
                      ? " · Actual check-in recorded"
                      : " · Scheduled only"}
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Include relevant samples</legend>
              <p>Your samples and samples from your relevant bookings.</p>
              {!sources.samples.length && <p>No relevant samples yet.</p>}
              {sources.samples.map((s) => (
                <label className="check-row" key={s.id}>
                  <input
                    type="checkbox"
                    checked={draft.sampleIds.includes(s.id)}
                    onChange={(e) =>
                      toggle("sampleIds", s.id, e.target.checked)
                    }
                  />
                  <span>
                    {s.code} · {s.compound}
                    {s.archived ? " · Archived" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Data links</legend>
              <p>
                Link to independently access-controlled research data. File
                uploads are not configured.
              </p>
              {draft.dataLinks.map((l, i) => (
                <div className="weekly-link-row" key={i}>
                  <label>
                    Link {i + 1} label
                    <input
                      required
                      value={l.label}
                      maxLength={150}
                      onChange={(e) =>
                        change(
                          "dataLinks",
                          draft.dataLinks.map((v, j) =>
                            j === i ? { ...v, label: e.target.value } : v,
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
                      value={l.url}
                      maxLength={1000}
                      onChange={(e) =>
                        change(
                          "dataLinks",
                          draft.dataLinks.map((v, j) =>
                            j === i ? { ...v, url: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      change(
                        "dataLinks",
                        draft.dataLinks.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove link {i + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={draft.dataLinks.length >= 10}
                onClick={() =>
                  change("dataLinks", [
                    ...draft.dataLinks,
                    { label: "", url: "" },
                  ])
                }
              >
                Add data link
              </button>
            </fieldset>
            <div className="action-row">
              <button className="secondary" disabled={busy}>
                Save draft
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                Save and review submission
              </button>
              {!!report?.latestRevision && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setHistory(true)}
                >
                  View submitted history
                </button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {history && report && (
        <Modal
          title="Submitted report history"
          onClose={() => setHistory(false)}
        >
          <div className="dialog-body">
            <WeeklyDetail id={report.id} user={user} />
          </div>
        </Modal>
      )}
    </section>
  );
}

function Review({ user, week }: { user: Member; week: string }) {
  const requestNumber = useRef(0);
  const [people, setPeople] = useState<WeeklyRoster[]>([]),
    [items, setItems] = useState<WeeklyRoster[]>([]),
    [person, setPerson] = useState(""),
    [project, setProject] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const rows = await api<WeeklyRoster[]>(`/weekly/review?week=${week}`);
      const filtered = await api<WeeklyRoster[]>(
        `/weekly/review?week=${week}${person ? `&person=${encodeURIComponent(person)}` : ""}${project ? `&project=${encodeURIComponent(project)}` : ""}`,
      );
      if (request === requestNumber.current) {
        setPeople(rows);
        setItems(filtered);
      }
    } catch (e) {
      if (request === requestNumber.current) setError(messageOf(e));
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, [week, person, project]);
  useEffect(() => {
    void load();
    return () => {
      requestNumber.current++;
    };
  }, [load]);
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(
        document.querySelectorAll<HTMLDetailsElement>(
          ".weekly-print-details:not([open])",
        ),
      );
      opened.forEach((d) => {
        d.open = true;
      });
    };
    const after = () => {
      opened.forEach((d) => {
        d.open = false;
      });
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return (
    <section className="weekly-review">
      <div className="no-print">
        <h2>Review reports</h2>
        <p>
          {user.appRole === "mentor"
            ? "Your assigned mentees only."
            : "Lab-wide submitted reports and eligible members."}{" "}
          Draft text is private. “Missing” means not yet submitted, including
          the current week; no deadline or background reminder is configured.
        </p>
        <div className="form-grid">
          <label>
            Filter by person
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">All eligible people</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter by project
            <input
              value={project}
              maxLength={500}
              onChange={(e) => setProject(e.target.value)}
            />
          </label>
        </div>
        <button
          className="secondary"
          disabled={loading || !!error}
          onClick={() => window.print()}
        >
          Print weekly meeting summary
        </button>
      </div>
      <ErrorNotice message={error} />
      {loading ? (
        <p role="status">Loading review…</p>
      ) : (
        <div className="weekly-print">
          <h2>Weekly meeting summary</h2>
          <p>{weekLabel(week)}</p>
          <p>
            {person
              ? `Person: ${people.find((p) => p.id === person)?.fullName ?? "Selected person"}`
              : "People: all in your review scope"}{" "}
            · Project: {project || "all"}
          </p>
          <p>
            {items.filter((p) => p.status === "submitted").length} submitted ·{" "}
            {items.filter((p) => p.status === "missing").length} not yet
            submitted
          </p>
          {!items.length && (
            <p>No eligible members or submitted reports match these filters.</p>
          )}
          {items.map((p) => (
            <article className="panel weekly-summary" key={p.id}>
              <h3>
                {p.fullName} ·{" "}
                {p.status === "missing"
                  ? "Not submitted"
                  : p.status === "submitted"
                    ? `Submitted · revision ${p.revision}`
                    : "Optional"}
              </h3>
              <p>
                Project: {p.project || "Not specified"}
                {!p.active ? " · Historical member (inactive)" : ""}
                {p.status === "submitted"
                  ? ` · ${p.reviewed ? "Reviewed" : "Awaiting review"}`
                  : ""}
              </p>
              {p.submittedAt && <p>Submitted: {formatDate(p.submittedAt)}</p>}
              {p.reportId && (
                <button
                  className="secondary no-print"
                  onClick={() => setSelected(p.reportId)}
                >
                  Open report by {p.fullName}
                </button>
              )}
              {p.content && (
                <details className="weekly-print-details">
                  <summary>Report content and discussion</summary>
                  <Content content={p.content} />
                  {p.comments.map((c) => (
                    <p className="preserve-lines" key={c.id}>
                      <strong>
                        {c.authorName} · revision {c.revision} · {c.kind}
                        {c.kind === "followup"
                          ? ` (${c.state}, owner: ${p.fullName})`
                          : ""}
                        {c.dueDate ? ` · due ${c.dueDate}` : ""}:
                      </strong>{" "}
                      {c.body}
                    </p>
                  ))}
                </details>
              )}
            </article>
          ))}
        </div>
      )}
      {selected && (
        <Modal title="Review weekly report" onClose={() => setSelected(null)}>
          <div className="dialog-body">
            <WeeklyDetail
              id={selected}
              user={user}
              onChanged={() => void load()}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}

export function Weekly({
  user,
  initialId,
}: {
  user: Member;
  initialId?: string | null;
}) {
  const [week, setWeek] = useState(weekStart()),
    [tab, setTab] = useState("mine"),
    [opened, setOpened] = useState(initialId ?? null),
    [generation, setGeneration] = useState(0);
  useEffect(() => setOpened(initialId ?? null), [initialId]);
  function selectWeek(value: string) {
    if (!value) return;
    const normalized = weekStart(value + "T12:00:00+05:30");
    if (
      normalized !== week &&
      window.confirm("Change week? Save any unsaved draft first.")
    ) {
      setWeek(normalized);
      setGeneration((g) => g + 1);
    }
  }
  return (
    <div className="weekly-page">
      <div className="no-print">
        <p>
          Monday–Sunday weeks in Asia/Kolkata. Drafts stay private; each
          submission preserves its content and timestamp.
        </p>
        <label>
          Week beginning (Monday)
          <input
            type="date"
            value={week}
            max={weekStart()}
            onChange={(e) => selectWeek(e.target.value)}
          />
        </label>
        <div className="action-row">
          <button
            className={tab === "mine" ? "primary" : "secondary"}
            onClick={() => setTab("mine")}
          >
            My weekly report
          </button>
          {canOpenReview(user.appRole) && (
            <button
              className={tab === "review" ? "primary" : "secondary"}
              onClick={() => setTab("review")}
            >
              Review weekly reports
            </button>
          )}
        </div>
      </div>
      {tab === "mine" ? (
        <ReportEditor
          key={`${week}-${generation}`}
          week={week}
          user={user}
          onUpdate={() => {}}
        />
      ) : (
        <Review key={week} week={week} user={user} />
      )}
      {opened && (
        <Modal
          title="Weekly progress notification"
          onClose={() => setOpened(null)}
        >
          <div className="dialog-body">
            <WeeklyDetail id={opened} user={user} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function WeeklyOverview({ onOpen }: { onOpen: () => void }) {
  const [summary, setSummary] = useState<{
      week: string;
      mine: string;
      openActions: number;
      review: {
        submitted: number;
        missing: number;
        awaitingReview: number;
      } | null;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      api<typeof summary>("/weekly/summary")
        .then((v) => {
          if (live) {
            setSummary(v);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(messageOf(e));
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel">
      <h2>Weekly progress</h2>
      <ErrorNotice message={error} />
      {summary ? (
        <>
          <p>{weekLabel(summary.week)}</p>
          <p>
            My report: {summary.mine} · {summary.openActions} open report
            follow-ups
          </p>
          {summary.review && (
            <p>
              {summary.review.submitted} submitted · {summary.review.missing}{" "}
              not yet submitted · {summary.review.awaitingReview} awaiting
              review
            </p>
          )}
        </>
      ) : (
        !error && <p role="status">Loading weekly progress…</p>
      )}
      <button className="secondary" onClick={onOpen}>
        Open Weekly Progress
      </button>
    </section>
  );
}
