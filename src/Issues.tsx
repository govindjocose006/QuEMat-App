import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import type { Member } from "../shared/schema.js";
import {
  issueCategories,
  issuePriorities,
  issueStatuses,
  issueStatusLabels,
  availableIssueActions,
  canDiscussIssue,
  canEditIssue,
  issueManager,
  type Issue,
  type IssueInput,
  type IssueDetail,
  type IssueOptions,
  type IssueSummary,
} from "../shared/issues.js";
import { api } from "./api.js";
import {
  ErrorNotice,
  FilterSummary,
  OptionalFields,
  Modal,
  formatDate,
  messageOf,
} from "./components.js";
const blank: IssueInput = {
  title: "",
  description: "",
  category: "general_decision",
  priority: "normal",
  dueDate: null,
  instrumentId: null,
  sampleId: null,
  project: "",
  assigneeId: null,
  supervisorAttention: false,
  dataLinks: [],
};
function toInput(i: Issue): IssueInput {
  return Object.fromEntries(
    Object.keys(blank).map((k) => [k, i[k as keyof IssueInput]]),
  ) as IssueInput;
}
function Links({ items }: { items: IssueInput["dataLinks"] }) {
  return items.length ? (
    <ul>
      {items.map((l, n) => (
        <li key={n}>
          <a href={l.url} target="_blank" rel="noreferrer">
            {l.label} ↗
          </a>
        </li>
      ))}
    </ul>
  ) : null;
}
function IssueCard({
  item: i,
  onOpen,
}: {
  item: Issue;
  onOpen?: (id: string) => void;
}) {
  return (
    <article className="panel issue-card">
      <div className="action-row">
        <span className="eyebrow">{i.code}</span>
        <span className={`status issue-${i.priority}`}>
          {i.priority} priority
        </span>
        <span className="status">{issueStatusLabels[i.status]}</span>
      </div>
      <h3>
        {onOpen ? (
          <button className="text-button" onClick={() => onOpen(i.id)}>
            {i.title}
          </button>
        ) : (
          i.title
        )}
      </h3>
      <p>
        {issueCategories[i.category]}
        {i.instrumentName ? ` · ${i.instrumentName}` : ""}
      </p>
      <p>
        Reporter: {i.reporterName} · Assignee: {i.assigneeName ?? "Unassigned"}
      </p>
      {i.dueDate && <p>Due: {i.dueDate} · Asia/Kolkata</p>}
      {i.supervisorAttention && (
        <p className="issue-attention">
          Supervisor attention requested ·{" "}
          {i.acknowledgedAt
            ? "acknowledgement recorded"
            : "not yet acknowledged"}
        </p>
      )}
    </article>
  );
}
function IssueForm({
  initial,
  options,
  onSaved,
  onCancel,
}: {
  initial: Issue | null;
  options: IssueOptions;
  onSaved: (i: IssueDetail) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<IssueInput>(
      initial ? toInput(initial) : blank,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function set<K extends keyof IssueInput>(key: K, v: IssueInput[K]) {
    setData((d) => ({ ...d, [key]: v }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api<IssueDetail>(
          initial ? `/issues/${initial.id}` : "/issues",
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
    <form onSubmit={submit} className="dialog-body task-form">
      <ErrorNotice message={error} />
      <p>
        Shared with approved lab members. Reporter and change history are
        recorded automatically.
      </p>
      <fieldset className="workflow-section">
        <legend>
          <span className="form-step">1</span>Issue or request
        </legend>
        <label>
          Title
          <input
            required
            minLength={3}
            maxLength={180}
            value={data.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            required
            minLength={5}
            maxLength={8000}
            rows={5}
            value={data.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
      </fieldset>
      <fieldset className="workflow-section">
        <legend>
          <span className="form-step">2</span>Responsibility & priority
        </legend>
        <div className="form-grid">
          <label>
            Category
            <select
              value={data.category}
              onChange={(e) =>
                set("category", e.target.value as IssueInput["category"])
              }
            >
              {Object.entries(issueCategories).map(([k, label]) => (
                <option value={k} key={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={data.priority}
              onChange={(e) =>
                set("priority", e.target.value as IssueInput["priority"])
              }
            >
              {issuePriorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Due date (Asia/Kolkata)
            <input
              type="date"
              value={data.dueDate ?? ""}
              onChange={(e) => set("dueDate", e.target.value || null)}
            />
          </label>
          <label>
            Assignee
            <select
              value={data.assigneeId ?? ""}
              onChange={(e) => set("assigneeId", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {initial?.assigneeId &&
                !options.people.some((p) => p.id === initial.assigneeId) && (
                  <option value={initial.assigneeId}>
                    Previous assignee (inactive) · {initial.assigneeName}
                  </option>
                )}
              {options.people
                .filter((p) => p.active || p.id === initial?.assigneeId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.active ? "" : " (inactive)"}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={data.supervisorAttention}
            onChange={(e) => set("supervisorAttention", e.target.checked)}
          />{" "}
          Supervisor attention requested
        </label>
        <p>
          Requesting attention does not acknowledge the item. The assignee or a
          lab manager must explicitly acknowledge it.
        </p>
      </fieldset>
      <OptionalFields
        title="Related records (optional)"
        initialOpen={
          !!(initial?.instrumentId || initial?.sampleId || initial?.project)
        }
      >
        <div className="form-grid">
          <label>
            Related instrument
            <select
              value={data.instrumentId ?? ""}
              onChange={(e) => set("instrumentId", e.target.value || null)}
            >
              <option value="">None</option>
              {options.instruments
                .filter((i) => !i.archived || i.id === initial?.instrumentId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.archived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Related sample
            <select
              value={data.sampleId ?? ""}
              onChange={(e) => set("sampleId", e.target.value || null)}
            >
              <option value="">None</option>
              {options.samples
                .filter((s) => !s.archived || s.id === initial?.sampleId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.compound}
                    {s.archived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Related project
            <input
              maxLength={500}
              value={data.project}
              onChange={(e) => set("project", e.target.value)}
            />
          </label>
        </div>
      </OptionalFields>
      {data.category === "helium_refill" && (
        <p className="notice">
          Record a manual observation and requested action. This is not a sensor
          reading.
        </p>
      )}
      {data.category === "purchase_approval" && (
        <p className="notice">
          Record the requested decision and discussion only. Resolving this item
          does not place an order, authorize payment or record a purchase.
        </p>
      )}
      <OptionalFields
        title="Data links (optional)"
        initialOpen={!!initial?.dataLinks.length}
      >
        <p>
          Use links to material shared only with intended readers. Attachments
          are not enabled.
        </p>
        {data.dataLinks.map((l, n) => (
          <div className="issue-link-row" key={n}>
            <label>
              Link {n + 1} label
              <input
                required
                maxLength={150}
                value={l.label}
                onChange={(e) =>
                  set(
                    "dataLinks",
                    data.dataLinks.map((x, j) =>
                      j === n ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Link {n + 1} URL
              <input
                required
                type="url"
                maxLength={1000}
                value={l.url}
                onChange={(e) =>
                  set(
                    "dataLinks",
                    data.dataLinks.map((x, j) =>
                      j === n ? { ...x, url: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                set(
                  "dataLinks",
                  data.dataLinks.filter((_, j) => j !== n),
                )
              }
            >
              Remove link {n + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={data.dataLinks.length >= 10}
          onClick={() =>
            set("dataLinks", [...data.dataLinks, { label: "", url: "" }])
          }
        >
          Add data link
        </button>
      </OptionalFields>
      <div className="form-actions workflow-actions">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save changes" : "Create issue/request"}
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function HistorySnapshot({ item: i }: { item: Issue }) {
  return (
    <div className="issue-history-snapshot">
      <p>
        <strong>{i.title}</strong>
      </p>
      <p className="preserve-lines">{i.description}</p>
      <p>
        {issueCategories[i.category]} · {i.priority} priority ·{" "}
        {issueStatusLabels[i.status]}
      </p>
      <p>
        Assignee: {i.assigneeName ?? "Unassigned"} · Project:{" "}
        {i.project || "None"} · Due: {i.dueDate ?? "None"}
      </p>
      <p>
        Instrument: {i.instrumentName ?? "None"} · Sample:{" "}
        {i.sampleCode ?? "None"}
      </p>
      <p>
        Supervisor attention{" "}
        {i.supervisorAttention ? "requested" : "not requested"}
      </p>
      <Links items={i.dataLinks} />
    </div>
  );
}
function Detail({
  id,
  user,
  onEdit,
  onChanged,
}: {
  id: string;
  user: Member;
  onEdit: (i: Issue) => void;
  onChanged: () => void;
}) {
  const [item, setItem] = useState<IssueDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [next, setNext] = useState(""),
    [body, setBody] = useState(""),
    [linkLabel, setLinkLabel] = useState(""),
    [linkUrl, setLinkUrl] = useState(""),
    [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    try {
      setItem(await api<IssueDetail>(`/issues/${id}`));
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function act(e: FormEvent, kind: "status" | "comment" | "attention") {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setItem(
        await api<IssueDetail>(
          `/issues/${id}/${kind === "comment" ? "comments" : kind}`,
          "POST",
          kind === "status"
            ? { version: item.version, status: next, reason }
            : kind === "attention"
              ? {
                  version: item.version,
                  supervisorAttention: !item.supervisorAttention,
                }
              : {
                  body,
                  dataLinks:
                    linkUrl || linkLabel
                      ? [{ label: linkLabel, url: linkUrl }]
                      : [],
                },
        ),
      );
      if (kind === "status") {
        setReason("");
        setNext("");
      } else if (kind === "comment") {
        setBody("");
        setLinkLabel("");
        setLinkUrl("");
      }
      setNotice(
        kind === "status"
          ? "Status and history saved."
          : kind === "attention"
            ? "Supervisor attention updated."
            : "Comment saved.",
      );
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const actions = item ? availableIssueActions(user, item) : [];
  return (
    <div className="dialog-body issue-detail">
      <ErrorNotice message={error} />
      {error && (
        <button className="secondary" onClick={() => void reload()}>
          Reload item
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {!item ? (
        <p role="status">Loading issue/request…</p>
      ) : (
        <>
          <IssueCard item={item} />
          <p className="preserve-lines">{item.description}</p>
          <dl>
            <dt>Project / sample</dt>
            <dd>
              {item.project || "None"} /{" "}
              {item.sampleCode
                ? `${item.sampleCode} · ${item.sampleCompound}`
                : "None"}
            </dd>
            <dt>Reported</dt>
            <dd>
              {item.reporterName} · {formatDate(item.createdAt)}
            </dd>
            <dt>First acknowledgement</dt>
            <dd>
              {item.acknowledgedAt
                ? `${item.acknowledgedName} · ${formatDate(item.acknowledgedAt)}`
                : "Not acknowledged"}
            </dd>
            <dt>Most recent resolution</dt>
            <dd>
              {item.resolvedAt
                ? `${item.resolvedName} · ${formatDate(item.resolvedAt)}`
                : "Not resolved"}
              {item.resolvedAt && item.status !== "resolved"
                ? " · subsequently reopened"
                : ""}
            </dd>
          </dl>
          <Links items={item.dataLinks} />
          {item.category === "helium_refill" && (
            <p>
              Helium information is a manual observation, not a sensor reading.
            </p>
          )}
          {item.category === "purchase_approval" && (
            <p>
              Decision record only; no automatic ordering or payment. Record any
              decision explicitly in a comment or status reason.
            </p>
          )}
          {canDiscussIssue(user, item) && (
            <form onSubmit={(e) => void act(e, "attention")}>
              <p>
                Let the assigned member handle routine work. Request supervisor
                attention when her input or decision is needed. She can still
                view every issue.
              </p>
              <button className="secondary" disabled={busy}>
                {item.supervisorAttention
                  ? "Clear supervisor attention"
                  : "Request supervisor attention"}
              </button>
            </form>
          )}
          {canEditIssue(user, item) && (
            <button className="secondary" onClick={() => onEdit(item)}>
              Edit details / assignment
            </button>
          )}
          {actions.length > 0 && (
            <form className="panel" onSubmit={(e) => void act(e, "status")}>
              <h3>Change status</h3>
              <label>
                New status
                <select
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                >
                  <option value="">Choose a status</option>
                  {actions.map((s) => (
                    <option key={s} value={s}>
                      {issueStatusLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status reason (optional)
                <textarea
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Record status change
              </button>
            </form>
          )}
          <section>
            <h3>Discussion</h3>
            {item.comments.length === 0 ? (
              <p>No comments yet.</p>
            ) : (
              item.comments.map((c) => (
                <article className="issue-comment" key={c.id}>
                  <p>
                    <strong>{c.authorName}</strong> · {formatDate(c.createdAt)}
                  </p>
                  <p className="preserve-lines">{c.body}</p>
                  <Links items={c.dataLinks} />
                </article>
              ))
            )}
            {canDiscussIssue(user, item) ? (
              <form onSubmit={(e) => void act(e, "comment")}>
                <label>
                  Comment / follow-up
                  <textarea
                    required
                    maxLength={4000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
                <details>
                  <summary>Add a discussion link</summary>
                  <label>
                    Discussion link label
                    <input
                      maxLength={150}
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                    />
                  </label>
                  <label>
                    Discussion link URL
                    <input
                      type="url"
                      maxLength={1000}
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                    />
                  </label>
                </details>
                <button className="primary" disabled={busy}>
                  Add comment
                </button>
              </form>
            ) : (
              <p>
                Discussion is limited to the reporter, assignee and application
                supervisors/administrators.
              </p>
            )}
          </section>
          <OptionalFields
            title={`Status & edit history (${item.events.length})`}
          >
            <ol className="issue-history">
              {item.events.map((e) => (
                <li key={e.id}>
                  <p>
                    <strong>{e.actorName}</strong> · {formatDate(e.createdAt)}
                  </p>
                  <p>
                    {e.kind === "created"
                      ? "Reported"
                      : e.kind === "updated"
                        ? "Details / assignment updated"
                        : `${issueStatusLabels[e.fromStatus!]} → ${issueStatusLabels[e.toStatus]}`}
                  </p>
                  <p className="preserve-lines">
                    {e.reason || "No reason provided."}
                  </p>
                  <details>
                    <summary>Saved details at this change</summary>
                    <HistorySnapshot item={e.after} />
                  </details>
                </li>
              ))}
            </ol>
          </OptionalFields>
        </>
      )}
    </div>
  );
}
export function Issues({
  user,
  initialId,
  onInitialOpened,
}: {
  user: Member;
  initialId: string | null;
  onInitialOpened: () => void;
}) {
  const [options, setOptions] = useState<IssueOptions | null>(null),
    [items, setItems] = useState<Issue[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [view, setView] = useState("work"),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [category, setCategory] = useState(""),
    [instrument, setInstrument] = useState(""),
    [assignee, setAssignee] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string | null>(initialId),
    [editing, setEditing] = useState<Issue | null | undefined>();
  useEffect(() => {
    if (initialId) {
      setSelected(initialId);
      onInitialOpened();
    }
  }, [initialId, onInitialOpened]);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const n = ++generation.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ view, q, offset: String(offset) });
      for (const [k, v] of Object.entries({
        status,
        priority,
        category,
        instrument,
        assignee,
      }))
        if (v) params.set(k, v);
      const [r, o] = await Promise.all([
        api<{ items: Issue[]; total: number }>(`/issues?${params}`),
        api<IssueOptions>("/issues/options"),
      ]);
      if (n !== generation.current) return;
      setItems(r.items);
      setTotal(r.total);
      setOptions(o);
      setError("");
    } catch (e) {
      if (n === generation.current) setError(messageOf(e));
    } finally {
      if (n === generation.current) setLoading(false);
    }
  }, [view, q, status, priority, category, instrument, assignee, offset]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      if (active) void reload();
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      generation.current++;
    };
  }, [reload]);
  const filter = (setter: (s: string) => void) => (v: string) => {
    setter(v);
    setOffset(0);
  };
  return (
    <section className="records-page issues-page">
      <h2 className="sr-only">Shared issues &amp; requests</h2>
      <div className="section-title">
        <div>
          <p>
            Coordinate lab work and decisions. Resolved history stays available.
          </p>
        </div>
        <button
          className="primary"
          disabled={!options}
          onClick={() => setEditing(null)}
        >
          New issue/request
        </button>
      </div>
      <ErrorNotice message={error} />
      {error && (
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void reload()}
        >
          Retry issues
        </button>
      )}
      <div className="issue-filters issue-primary-filters">
        <label>
          Search issues
          <input
            maxLength={200}
            value={q}
            onChange={(e) => filter(setQ)(e.target.value)}
            placeholder="Title, ID, project, person, instrument"
          />
        </label>
        <label>
          Work view
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setStatus("");
              setOffset(0);
            }}
          >
            <option value="work">Open work (unresolved)</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Assignee
          <select
            value={assignee}
            onChange={(e) => filter(setAssignee)(e.target.value)}
          >
            <option value="">Any assignee</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {options?.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <OptionalFields
        title={`More filters${[status, priority, category, instrument].filter(Boolean).length ? ` (${[status, priority, category, instrument].filter(Boolean).length} active)` : ""}`}
      >
        <div className="issue-filters">
          <label>
            Status
            <select
              value={status}
              onChange={(e) => filter(setStatus)(e.target.value)}
            >
              <option value="">Any status</option>
              {issueStatuses
                .filter(
                  (s) =>
                    view === "all" ||
                    (view === "resolved" ? s === "resolved" : s !== "resolved"),
                )
                .map((s) => (
                  <option key={s} value={s}>
                    {issueStatusLabels[s]}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => filter(setPriority)(e.target.value)}
            >
              <option value="">Any priority</option>
              {issuePriorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => filter(setCategory)(e.target.value)}
            >
              <option value="">Any category</option>
              {Object.entries(issueCategories).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Instrument
            <select
              value={instrument}
              onChange={(e) => filter(setInstrument)(e.target.value)}
            >
              <option value="">Any instrument</option>
              {options?.instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </OptionalFields>
      {loading && <p role="status">Loading issues…</p>}
      <FilterSummary
        count={
          loading
            ? "Updating results…"
            : error
              ? "Results unavailable"
              : `${total} matching item${total === 1 ? "" : "s"}`
        }
        active={[
          q && `Search: ${q}`,
          status && `Status: ${issueStatusLabels[status as Issue["status"]]}`,
          priority && `Priority: ${priority}`,
          category &&
            `Category: ${issueCategories[category as Issue["category"]]}`,
          instrument &&
            `Instrument: ${options?.instruments.find((i) => i.id === instrument)?.name ?? "Selected"}`,
          assignee &&
            `Assignee: ${assignee === "me" ? "Me" : assignee === "unassigned" ? "Unassigned" : (options?.people.find((p) => p.id === assignee)?.fullName ?? "Selected")}`,
        ].filter((value): value is string => !!value)}
        onClear={() => {
          setQ("");
          setStatus("");
          setPriority("");
          setCategory("");
          setInstrument("");
          setAssignee("");
          setOffset(0);
        }}
      />
      <div className="issue-grid">
        {!loading &&
          !error &&
          items.map((i) => (
            <IssueCard key={i.id} item={i} onOpen={setSelected} />
          ))}
      </div>
      {!loading && !error && !items.length && (
        <p role="status">No issues match this view.</p>
      )}
      {!loading && !error && total > 50 && (
        <div className="action-row">
          <button
            className="secondary"
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous page
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, total)} of {total}
          </span>
          <button
            className="secondary"
            disabled={offset + 50 >= total}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next page
          </button>
        </div>
      )}
      {editing !== undefined && options ? (
        <Modal
          title={editing ? `Edit ${editing.code}` : "New issue/request"}
          onClose={() => setEditing(undefined)}
        >
          <IssueForm
            initial={editing}
            options={options}
            onCancel={() => setEditing(undefined)}
            onSaved={(i) => {
              setEditing(undefined);
              setSelected(i.id);
              void reload();
            }}
          />
        </Modal>
      ) : (
        selected && (
          <Modal
            title="Issue/request details"
            onClose={() => setSelected(null)}
          >
            <Detail
              key={selected}
              id={selected}
              user={user}
              onEdit={setEditing}
              onChanged={() => void reload()}
            />
          </Modal>
        )
      )}
    </section>
  );
}
export function IssuesOverview({
  user,
  onOpen,
}: {
  user: Member;
  onOpen: (id: string) => void;
}) {
  const [summary, setSummary] = useState<IssueSummary | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api<IssueSummary>("/issues/summary")
        .then((s) => {
          if (active) {
            setSummary(s);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(messageOf(e));
        });
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel">
      <h2>Issues requiring attention</h2>
      <ErrorNotice message={error} />
      {!summary && !error && <p role="status">Loading attention items…</p>}
      {summary && (
        <div className="issue-attention-grid">
          {summary.counts.urgent === 0 &&
            summary.counts.assigned === 0 &&
            (!issueManager(user.appRole) ||
              summary.counts.supervisor === 0) && (
              <p className="quiet-summary">
                No urgent or assigned issues
                {issueManager(user.appRole)
                  ? ", or requests for supervisor attention"
                  : ""}
                .
              </p>
            )}
          {(
            [
              "urgent",
              "assigned",
              ...(issueManager(user.appRole) ? (["supervisor"] as const) : []),
            ] as const
          )
            .filter((key) => summary.counts[key] > 0)
            .map((key) => (
              <section key={key}>
                <h3>
                  {key === "urgent"
                    ? "Urgent unresolved"
                    : key === "assigned"
                      ? "Assigned to me"
                      : "Supervisor attention requested"}{" "}
                  ({summary.counts[key]})
                </h3>
                {summary[key].length ? (
                  <ul>
                    {summary[key].map((i) => (
                      <li key={i.id}>
                        <button
                          className="text-button"
                          onClick={() => onOpen(i.id)}
                        >
                          {i.code} · {i.title}
                        </button>{" "}
                        · {issueStatusLabels[i.status]}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No items.</p>
                )}
                {key === "supervisor" && (
                  <p>Requested attention is separate from acknowledgement.</p>
                )}
                {summary.counts[key] > 5 && (
                  <p>
                    Showing 5 most recently updated; use Issues &amp; Requests
                    for all items.
                  </p>
                )}
              </section>
            ))}
        </div>
      )}
    </section>
  );
}
