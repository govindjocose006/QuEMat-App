import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "./api.js";
import {
  ErrorNotice,
  FilterSummary,
  OptionalFields,
  Status,
  messageOf,
} from "./components.js";
import type { Member } from "../shared/schema.js";
import {
  orderLabels,
  orderStatuses,
  canManageOrder,
  orderManager,
  parseRupees,
  rupees,
  type ChemicalOrder,
  type OrderDetail,
} from "../shared/orders.js";
const date = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const value = (f: FormData, k: string) => String(f.get(k) ?? "");
const number = (f: FormData, k: string) => Number(value(f, k));
type Mode = "new" | "edit" | "record" | "receive" | "cancel" | null;
export function Orders({
  user,
  initialId,
  onOpened,
}: {
  user: Member;
  initialId: string | null;
  onOpened: () => void;
}) {
  const [items, setItems] = useState<ChemicalOrder[]>([]),
    [total, setTotal] = useState(0),
    [view, setView] = useState("work"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [id, setId] = useState<string | null>(null),
    [detail, setDetail] = useState<OrderDetail | null>(null),
    [mode, setMode] = useState<Mode>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [orderedBy, setOrderedBy] = useState(user.id),
    [people, setPeople] = useState<{ id: string; fullName: string }[]>([]);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    detailHeading.current?.focus();
  }, [detail?.id]);
  useEffect(() => {
    formHeading.current?.focus();
  }, [mode]);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const g = ++generation.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        view,
        q: search,
        offset: String(offset),
      });
      if (status) q.set("status", status);
      const [page, item] = await Promise.all([
        api<{ items: ChemicalOrder[]; total: number }>("/orders?" + q),
        id ? api<OrderDetail>("/orders/" + id) : Promise.resolve(null),
      ]);
      if (g === generation.current) {
        setItems(page.items);
        setTotal(page.total);
        setDetail(item);
        setError("");
      }
    } catch (e) {
      if (g === generation.current) setError(messageOf(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, [view, search, status, offset, id]);
  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (initialId) {
      setId(initialId);
      setDetail(null);
      setMode(null);
      onOpened();
    }
  }, [initialId, onOpened]);
  useEffect(() => {
    if (mode !== "record") return;
    setPeople([]);
    setOrderedBy(detail?.orderedBy ?? user.id);
    let active = true;
    void api<{ id: string; fullName: string }[]>("/orders/options")
      .then((p) => {
        if (active) setPeople(p);
      })
      .catch((e) => {
        if (active) setError(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [mode, detail?.orderedBy, user.id]);
  const open = (r: ChemicalOrder) => {
    setMode(null);
    setNotice("");
    if (r.id === id) {
      // The ID-dependent effect will not run again for the same selection.
      // Keep the last successful detail visible while refreshing it explicitly.
      void reload();
    } else {
      setDetail(null);
      setId(r.id);
    }
  };
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      let data: object;
      let path = "/orders";
      let method = "POST";
      if (mode === "new" || mode === "edit") {
        data = {
          chemical: value(f, "chemical"),
          casNumber: value(f, "casNumber"),
          purity: value(f, "purity"),
          catalogue: value(f, "catalogue"),
          quantity: number(f, "quantity"),
          unit: value(f, "unit"),
          purpose: value(f, "purpose"),
          project: value(f, "project"),
          preferredSupplier: value(f, "preferredSupplier"),
          estimatedCostPaise: parseRupees(value(f, "estimate")),
          notes: value(f, "notes"),
          ...(mode === "edit" ? { version: detail!.version } : {}),
        };
        if (mode === "edit") {
          path += "/" + detail!.id;
          method = "PUT";
        }
      } else {
        if (!detail) throw Error("Reload the request first.");
        path += "/" + detail.id;
        if (mode === "record") {
          path += "/record";
          data = {
            version: detail.version,
            supplier: value(f, "supplier"),
            orderedBy: value(f, "orderedBy"),
            orderedOn: value(f, "orderedOn"),
            expectedOn: value(f, "expectedOn") || null,
            costPaise: parseRupees(value(f, "cost")),
            reference: value(f, "reference"),
          };
        } else if (mode === "receive") {
          path += "/receive";
          data = {
            version: detail.version,
            quantity: number(f, "received"),
            receivedOn: value(f, "receivedOn"),
            notes: value(f, "notes"),
          };
        } else {
          path += "/cancel";
          data = { version: detail.version, reason: value(f, "reason") };
        }
      }
      const result = await api<OrderDetail>(
        path,
        method as "POST" | "PUT",
        data,
      );
      setDetail(result);
      setId(result.id);
      setMode(null);
      setNotice("Saved. Order tracking and history updated.");
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const input = (
    label: string,
    name: string,
    defaultValue: string | number = "",
    type = "text",
    required = false,
    extra: object = {},
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        {...extra}
      />
    </label>
  );
  const form = mode && (mode === "new" || detail) && (
    <form
      className="panel task-form order-form"
      key={`${mode}-${detail?.id ?? "new"}-${detail?.version ?? 0}`}
      onSubmit={save}
    >
      <h3 ref={formHeading} tabIndex={-1}>
        {mode === "new"
          ? "New chemical request"
          : mode === "edit"
            ? "Edit chemical request"
            : mode === "record"
              ? "Record an order already placed"
              : mode === "receive"
                ? "Record delivery"
                : "Cancel remaining request"}
      </h3>
      {(mode === "new" || mode === "edit") && (
        <>
          <fieldset className="workflow-section">
            <legend>
              <span className="form-step">1</span>Chemical & quantity
            </legend>
            <div className="form-grid">
              {input(
                "Chemical name",
                "chemical",
                mode === "edit" ? detail!.chemical : "",
                "text",
                true,
                { maxLength: 200 },
              )}
              {input(
                "Quantity requested",
                "quantity",
                mode === "edit" ? detail!.quantity : 1,
                "number",
                true,
                { min: 0.001, max: 1000000, step: 0.001 },
              )}
              <label>
                Unit
                <select
                  name="unit"
                  defaultValue={mode === "edit" ? detail!.unit : "g"}
                >
                  {["g", "kg", "mg", "mL", "L", "bottle", "pack", "piece"].map(
                    (u) => (
                      <option key={u}>{u}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Purpose
                <textarea
                  name="purpose"
                  defaultValue={mode === "edit" ? detail!.purpose : ""}
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </label>
            </div>
          </fieldset>
          <OptionalFields
            title="Specifications & purchasing details (optional)"
            initialOpen={mode === "edit"}
          >
            <div className="form-grid">
              {input(
                "CAS number (optional)",
                "casNumber",
                mode === "edit" ? detail!.casNumber : "",
                "text",
                false,
                { maxLength: 80 },
              )}
              {input(
                "Purity / grade (optional)",
                "purity",
                mode === "edit" ? detail!.purity : "",
              )}
              {input(
                "Catalogue number (optional)",
                "catalogue",
                mode === "edit" ? detail!.catalogue : "",
              )}
              {input(
                "Project (optional)",
                "project",
                mode === "edit" ? detail!.project : "",
              )}
              {input(
                "Preferred supplier (optional)",
                "preferredSupplier",
                mode === "edit" ? detail!.preferredSupplier : "",
              )}
              {input(
                "Estimated cost — INR (optional)",
                "estimate",
                mode === "edit" && detail!.estimatedCostPaise !== null
                  ? (detail!.estimatedCostPaise / 100).toFixed(2)
                  : "",
                "text",
                false,
                { inputMode: "decimal" },
              )}
              <label>
                Request notes (optional)
                <textarea
                  name="notes"
                  defaultValue={mode === "edit" ? detail!.notes : ""}
                  maxLength={4000}
                />
              </label>
            </div>
          </OptionalFields>
        </>
      )}
      {mode === "record" && (
        <>
          <p>
            This saves a record only. Place orders through the institute’s
            normal process.
          </p>
          <div className="form-grid">
            {input(
              "Supplier",
              "supplier",
              detail!.supplier || detail!.preferredSupplier,
              "text",
              true,
              { maxLength: 200 },
            )}
            <label>
              Ordered by
              <select
                name="orderedBy"
                required
                value={orderedBy}
                onChange={(e) => setOrderedBy(e.target.value)}
              >
                {(orderManager(user)
                  ? [
                      ...people,
                      ...(detail?.orderedBy &&
                      !people.some((p) => p.id === detail.orderedBy)
                        ? [
                            {
                              id: detail.orderedBy,
                              fullName:
                                detail.orderedName ??
                                "Previously recorded member",
                            },
                          ]
                        : []),
                    ]
                  : [
                      ...people.filter((p) => p.id === user.id),
                      ...(detail?.orderedBy && detail.orderedBy !== user.id
                        ? [
                            {
                              id: detail.orderedBy,
                              fullName:
                                detail.orderedName ??
                                "Previously recorded member",
                            },
                          ]
                        : []),
                    ]
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            {input(
              "Order date (IST)",
              "orderedOn",
              detail!.orderedOn || date(),
              "date",
              true,
              { max: date() },
            )}
            {input(
              "Expected delivery date (optional)",
              "expectedOn",
              detail!.expectedOn || "",
              "date",
            )}
            {input(
              "Recorded order cost — INR (optional)",
              "cost",
              detail!.costPaise === null
                ? ""
                : (detail!.costPaise / 100).toFixed(2),
              "text",
              false,
              { inputMode: "decimal" },
            )}
            {input(
              "Order / invoice reference (optional)",
              "reference",
              detail!.reference,
            )}
          </div>
        </>
      )}
      {mode === "receive" && (
        <>
          <p>
            Remaining:{" "}
            {Math.round((detail!.quantity - detail!.receivedQuantity) * 1000) /
              1000}{" "}
            {detail!.unit}. Delivery records are retained.
          </p>
          {input("Quantity received now", "received", "", "number", true, {
            min: 0.001,
            max:
              Math.round((detail!.quantity - detail!.receivedQuantity) * 1000) /
              1000,
            step: 0.001,
          })}
          {input("Delivery date (IST)", "receivedOn", date(), "date", true, {
            min: detail!.orderedOn ?? undefined,
            max: date(),
          })}
          <label>
            Delivery notes (optional)
            <textarea name="notes" maxLength={2000} />
          </label>
        </>
      )}
      {mode === "cancel" && (
        <>
          <p>
            Closes the remaining request in this tracker. It does not cancel a
            supplier order or arrange a refund. Existing deliveries remain in
            history.
          </p>
          <label>
            Cancellation reason (optional)
            <textarea name="reason" maxLength={2000} />
          </label>
        </>
      )}
      <div className="action-row workflow-actions">
        <button
          className="primary"
          disabled={busy || (mode === "record" && !people.length)}
        >
          {busy
            ? "Saving…"
            : mode === "new"
              ? "Save chemical request"
              : mode === "record"
                ? "Save order record"
                : mode === "receive"
                  ? "Save delivery"
                  : mode === "cancel"
                    ? "Confirm cancellation"
                    : "Save request changes"}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => setMode(null)}
        >
          Close form
        </button>
      </div>
    </form>
  );
  return (
    <section className="orders-page records-page">
      <div className="section-title">
        <div>
          <h2>Chemicals & orders</h2>
          <p>
            Shared chemical requests, recorded costs and deliveries. Records do
            not initiate purchases or payments.
          </p>
        </div>
        <div className="action-row">
          <button
            className="primary"
            onClick={() => {
              setMode("new");
              setNotice("");
            }}
          >
            New chemical request
          </button>
          <button
            className="secondary"
            disabled={loading || busy}
            onClick={() => void reload()}
          >
            Refresh orders
          </button>
        </div>
      </div>
      <ErrorNotice message={error} />
      {error && (
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void reload()}
        >
          Retry orders
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Loading order records…</p>}
      {form}
      {detail && mode !== "new" && (
        <article className="panel">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setMode(null);
              setDetail(null);
              setId(null);
              setNotice("");
            }}
          >
            Close order details
          </button>
          <h3 ref={detailHeading} tabIndex={-1}>
            {detail.code} · {detail.chemical}
          </h3>
          <Status value={orderLabels[detail.status]} />
          <p>
            Requested by {detail.requesterName} · {detail.quantity}{" "}
            {detail.unit} · received {detail.receivedQuantity} {detail.unit}
          </p>
          <p>Purpose: {detail.purpose}</p>
          <p>
            Project: {detail.project || "Not specified"} · CAS:{" "}
            {detail.casNumber || "Not recorded"} · Purity:{" "}
            {detail.purity || "Not recorded"} · Catalogue:{" "}
            {detail.catalogue || "Not recorded"}
          </p>
          <p>
            Preferred supplier: {detail.preferredSupplier || "Not recorded"} ·
            Estimated cost: {rupees(detail.estimatedCostPaise)}
          </p>
          {detail.notes && <p>Request notes: {detail.notes}</p>}
          {detail.orderedBy && (
            <>
              <p>
                Supplier: {detail.supplier} · Ordered by: {detail.orderedName} ·
                Order date: {detail.orderedOn}
              </p>
              <p>
                Order cost: {rupees(detail.costPaise)} · Expected:{" "}
                {detail.expectedOn || "Not recorded"} · Reference:{" "}
                {detail.reference || "Not recorded"}
              </p>
            </>
          )}
          {canManageOrder(user, detail) && !mode && (
            <div className="action-row">
              {detail.status === "requested" && (
                <>
                  <button className="secondary" onClick={() => setMode("edit")}>
                    Edit request
                  </button>
                  <button className="primary" onClick={() => setMode("record")}>
                    Record order
                  </button>
                </>
              )}
              {detail.orderedBy && (
                <button className="secondary" onClick={() => setMode("record")}>
                  Correct order details
                </button>
              )}
              {["ordered", "part_received"].includes(detail.status) && (
                <button className="primary" onClick={() => setMode("receive")}>
                  Record delivery
                </button>
              )}
              {!["received", "cancelled"].includes(detail.status) && (
                <button className="secondary" onClick={() => setMode("cancel")}>
                  Cancel remaining request
                </button>
              )}
            </div>
          )}
          <h4>Deliveries</h4>
          {detail.deliveries.length ? (
            detail.deliveries.map((d) => (
              <p key={d.id}>
                {d.receivedOn} · {d.quantity} {detail.unit} · received by{" "}
                {d.receivedName}
                {d.notes ? " · " + d.notes : ""}
              </p>
            ))
          ) : (
            <p>No deliveries recorded.</p>
          )}
          <OptionalFields title={`Retained history (${detail.events.length})`}>
            <h4>Retained history</h4>
            {detail.events.map((e) => (
              <details key={e.id}>
                <summary>
                  {e.kind} · {e.actorName} · revision {e.version} ·{" "}
                  {new Date(e.createdAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </summary>
                <p>{e.reason || "No additional note."}</p>
                <p>
                  {e.after.chemical} · CAS {e.after.casNumber || "Not recorded"}{" "}
                  · {e.after.purity} · {e.after.catalogue}
                </p>
                <p>
                  Purpose: {e.after.purpose} · Project: {e.after.project} ·
                  Request notes: {e.after.notes}
                </p>
                <p>
                  State: {orderLabels[e.after.status]} · {e.after.quantity}{" "}
                  {e.after.unit} · received {e.after.receivedQuantity}{" "}
                  {e.after.unit} · order cost {rupees(e.after.costPaise)}
                </p>
                <p>
                  Supplier: {e.after.supplier || "Not recorded"} · Order date:{" "}
                  {e.after.orderedOn || "Not recorded"} · Expected:{" "}
                  {e.after.expectedOn || "Not recorded"} · Reference:{" "}
                  {e.after.reference || "Not recorded"}
                </p>
              </details>
            ))}
          </OptionalFields>
        </article>
      )}
      <div className="filters">
        <label>
          Order view
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setOffset(0);
            }}
          >
            <option value="work">Open work</option>
            <option value="closed">Received / cancelled</option>
            <option value="mine">My requests</option>
            <option value="all">All requests</option>
          </select>
        </label>
        <label>
          Order status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Any status</option>
            {orderStatuses.map((s) => (
              <option key={s} value={s}>
                {orderLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search chemicals or orders
          <input
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      <FilterSummary
        count={
          loading
            ? "Updating results…"
            : error
              ? "Results unavailable"
              : `${total} requests`
        }
        active={[
          search && `Search: ${search}`,
          status && `Status: ${orderLabels[status as ChemicalOrder["status"]]}`,
        ].filter((value): value is string => !!value)}
        onClear={() => {
          setSearch("");
          setStatus("");
          setOffset(0);
        }}
      />
      {!loading && !error && !items.length && (
        <p className="list-empty">No requests in this view.</p>
      )}
      <div className="record-list">
        {!loading &&
          !error &&
          items.map((r) => (
            <article className="panel record-row order-row" key={r.id}>
              <h3>
                {r.code} · {r.chemical}
              </h3>
              <Status value={orderLabels[r.status]} />
              <p>
                {r.quantity} {r.unit} · {r.requesterName} · received{" "}
                {r.receivedQuantity} {r.unit}
              </p>
              <p>
                {r.supplier || r.preferredSupplier || "Supplier not recorded"} ·{" "}
                {rupees(r.costPaise)}
              </p>
              <button className="secondary" onClick={() => open(r)}>
                Open {r.code}
              </button>
            </article>
          ))}
      </div>
      {!loading && !error && total > 50 && (
        <div className="action-row">
          <button
            className="secondary"
            disabled={loading || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Newer orders
          </button>
          <p>
            {total} requests · Page {Math.floor(offset / 50) + 1}
          </p>
          <button
            className="secondary"
            disabled={loading || offset + 50 >= total}
            onClick={() => setOffset((n) => n + 50)}
          >
            Older orders
          </button>
        </div>
      )}
    </section>
  );
}
export function OrdersOverview({ open }: { open: () => void }) {
  const [data, setData] = useState<{
      requested: number;
      awaiting: number;
      overdue: number;
    } | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const g = ++generation.current;
    try {
      const result = await api<{
        requested: number;
        awaiting: number;
        overdue: number;
      }>("/orders/summary");
      if (g === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (g === generation.current) setError(messageOf(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    const run = () => {
      if (active && document.visibilityState === "visible") void reload();
    };
    run();
    const t = setInterval(run, 30000);
    window.addEventListener("focus", run);
    return () => {
      active = false;
      generation.current++;
      clearInterval(t);
      window.removeEventListener("focus", run);
    };
  }, [reload]);
  return (
    <section className="panel">
      <h3>Chemicals & orders</h3>
      <ErrorNotice message={error} />
      {data && (
        <p>
          {data.requested} requested · {data.awaiting} awaiting delivery ·{" "}
          {data.overdue} past expected date
        </p>
      )}
      <button className="secondary" onClick={open}>
        Open chemical orders
      </button>
      {error && (
        <button className="secondary" onClick={() => void reload()}>
          Retry order summary
        </button>
      )}
    </section>
  );
}
