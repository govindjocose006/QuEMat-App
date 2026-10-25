import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, member, type DB, type SQL } from "./db.js";
import type { Member } from "../shared/schema.js";
import {
  requestSchema,
  recordOrderSchema,
  receiveSchema,
  cancelSchema,
  orderStatuses,
  canManageOrder,
  orderManager,
  type ChemicalOrder,
} from "../shared/orders.js";
const select = `SELECT o.id,o.code,o.requester_id AS "requesterId",u.full_name AS "requesterName",o.chemical,o.cas_number AS "casNumber",o.purity,o.catalogue,o.quantity::float8 AS quantity,o.unit,o.purpose,o.project,o.preferred_supplier AS "preferredSupplier",o.notes,o.estimated_cost_paise::float8 AS "estimatedCostPaise",o.status,o.version,o.received_quantity::float8 AS "receivedQuantity",o.supplier,o.ordered_by AS "orderedBy",p.full_name AS "orderedName",to_char(o.ordered_on,'YYYY-MM-DD') AS "orderedOn",to_char(o.expected_on,'YYYY-MM-DD') AS "expectedOn",o.cost_paise::float8 AS "costPaise",o.reference,o.created_at AS "createdAt",o.updated_at AS "updatedAt" FROM chemical_orders o JOIN users u ON u.id=o.requester_id LEFT JOIN users p ON p.id=o.ordered_by`;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function installOrders(
  app: Express,
  db: DB,
  approved: RequestHandler,
  current: (res: Response) => Member,
  fail: (status: number, message: string) => never,
) {
  async function row(tx: SQL, id: string) {
    const r = (
      await tx.query<ChemicalOrder>(select + " WHERE o.id=$1", [id])
    )[0];
    if (!r) fail(404, "Chemical request not found.");
    return r;
  }
  async function detail(tx: SQL, id: string) {
    return {
      ...(await row(tx, id)),
      events: await tx.query(
        `SELECT e.id,u.full_name AS "actorName",e.kind,e.version,e.created_at AS "createdAt",e.before_state AS before,e.after_state AS after,e.reason FROM chemical_order_events e JOIN users u ON u.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.version`,
        [id],
      ),
      deliveries: await tx.query(
        `SELECT d.id,d.quantity::float8 AS quantity,to_char(d.received_on,'YYYY-MM-DD') AS "receivedOn",u.full_name AS "receivedName",d.notes,d.created_at AS "createdAt" FROM chemical_deliveries d JOIN users u ON u.id=d.received_by WHERE d.order_id=$1 ORDER BY d.created_at,d.id`,
        [id],
      ),
    };
  }
  async function event(
    tx: SQL,
    u: Member,
    after: ChemicalOrder,
    kind: string,
    before: ChemicalOrder | null = null,
    reason = "",
  ) {
    await tx.query(
      "INSERT INTO chemical_order_events(id,order_id,actor_id,kind,version,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",
      [
        randomUUID(),
        after.id,
        u.id,
        kind,
        after.version,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
        reason,
      ],
    );
    await audit(tx, u.id, "chemical." + kind, after.id, {
      before,
      after,
      reason,
    });
    const people = new Set(
      [after.requesterId, after.orderedBy, before?.orderedBy].filter(
        (x): x is string => !!x,
      ),
    );
    for (const p of await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE status='approved' AND onboarded=1 AND app_role IN ('supervisor','administrator')",
    ))
      people.add(p.id);
    for (const id of people)
      await tx.query(
        "INSERT INTO notifications(id,user_id,order_id,event_key,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING",
        [
          randomUUID(),
          id,
          after.id,
          `${after.id}:${after.version}`,
          `${after.code}: ${after.chemical} — ${kind}. Recorded in the lab tracker.`,
        ],
      );
  }
  async function permitted(
    tx: SQL,
    res: Response,
    id: string,
    version: number,
  ) {
    const u = await member(tx, current(res).id);
    if (!u || u.status !== "approved" || !u.onboarded)
      fail(403, "Approved membership required.");
    const r = await row(tx, id);
    if (!canManageOrder(u, r))
      fail(
        403,
        "Only the requester, supervisor or administrator can change this request.",
      );
    if (r.version !== version)
      fail(409, "This request changed. Reload before saving.");
    return { u, r };
  }
  app.get("/api/orders/options", approved, async (_req, res) =>
    res.json(
      await db.query(
        "SELECT id,full_name AS \"fullName\" FROM users WHERE status='approved' AND onboarded=1 ORDER BY full_name",
      ),
    ),
  );
  app.get("/api/orders/summary", approved, async (_req, res) =>
    res.json(
      (
        await db.query(
          `SELECT count(*) FILTER(WHERE status='requested')::int AS requested,count(*) FILTER(WHERE status IN ('ordered','part_received'))::int AS awaiting,count(*) FILTER(WHERE status IN ('ordered','part_received') AND expected_on<(now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS overdue FROM chemical_orders`,
        )
      )[0],
    ),
  );
  app.get("/api/orders", approved, async (req, res) => {
    const q = z
      .object({
        view: z.enum(["work", "closed", "all", "mine"]).default("work"),
        status: z.enum(orderStatuses).optional(),
        q: z.string().trim().max(200).default(""),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    const values: unknown[] = [];
    const terms: string[] = [];
    const add = (s: string, v: unknown) => {
      values.push(v);
      terms.push(s.replace("?", `$${values.length}`));
    };
    if (q.view === "work")
      terms.push("o.status NOT IN ('received','cancelled')");
    if (q.view === "closed") terms.push("o.status IN ('received','cancelled')");
    if (q.view === "mine") add("o.requester_id=?", current(res).id);
    if (q.status) add("o.status=?", q.status);
    if (q.q)
      add(
        "concat_ws(' ',o.code,o.chemical,o.cas_number,o.catalogue,o.supplier,o.project) ILIKE ?",
        "%" + q.q + "%",
      );
    const where = terms.length ? " WHERE " + terms.join(" AND ") : "";
    const [count] = await db.query<{ count: string }>(
      "SELECT count(*) FROM chemical_orders o" + where,
      values,
    );
    values.push(50, q.offset);
    res.json({
      items: await db.query(
        select +
          where +
          ` ORDER BY o.created_at DESC,o.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      ),
      total: Number(count.count),
    });
  });
  app.get("/api/orders/:id", approved, async (req, res) =>
    res.json(await detail(db, String(req.params.id))),
  );
  app.post("/api/orders", approved, async (req, res) => {
    const input = requestSchema.parse(req.body);
    const id = randomUUID();
    await db.write(async (tx) => {
      const u = await member(tx, current(res).id);
      if (!u || u.status !== "approved" || !u.onboarded)
        fail(403, "Approved membership required.");
      await tx.query(
        `INSERT INTO chemical_orders(id,requester_id,chemical,cas_number,purity,catalogue,quantity,unit,purpose,project,preferred_supplier,estimated_cost_paise,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          u.id,
          input.chemical,
          input.casNumber,
          input.purity,
          input.catalogue,
          input.quantity,
          input.unit,
          input.purpose,
          input.project,
          input.preferredSupplier,
          input.estimatedCostPaise,
          input.notes,
        ],
      );
      await event(tx, u, await row(tx, id), "requested");
    });
    res.status(201).json(await detail(db, id));
  });
  app.put("/api/orders/:id", approved, async (req, res) => {
    const input = requestSchema
      .extend({ version: z.number().int().positive() })
      .parse(req.body);
    const id = String(req.params.id);
    await db.write(async (tx) => {
      const { u, r } = await permitted(tx, res, id, input.version);
      if (r.status !== "requested")
        fail(
          409,
          "Only un-ordered requests can be edited. Order and delivery history is retained.",
        );
      await tx.query(
        `UPDATE chemical_orders SET chemical=$2,cas_number=$3,purity=$4,catalogue=$5,quantity=$6,unit=$7,purpose=$8,project=$9,preferred_supplier=$10,estimated_cost_paise=$11,notes=$12,version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.chemical,
          input.casNumber,
          input.purity,
          input.catalogue,
          input.quantity,
          input.unit,
          input.purpose,
          input.project,
          input.preferredSupplier,
          input.estimatedCostPaise,
          input.notes,
        ],
      );
      await event(tx, u, await row(tx, id), "edited", r);
    });
    res.json(await detail(db, id));
  });
  app.post("/api/orders/:id/record", approved, async (req, res) => {
    const input = recordOrderSchema.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const { u, r } = await permitted(tx, res, id, input.version);
      if (r.status !== "requested" && !r.orderedBy)
        fail(409, "This request is closed without an order.");
      if (
        !orderManager(u) &&
        input.orderedBy !== u.id &&
        input.orderedBy !== r.orderedBy
      )
        fail(
          403,
          "Only a supervisor or administrator can record an order on behalf of another member.",
        );
      if (
        input.orderedBy !== r.orderedBy &&
        !(
          await tx.query(
            "SELECT id FROM users WHERE id=$1 AND status='approved' AND onboarded=1",
            [input.orderedBy],
          )
        ).length
      )
        fail(400, "Select an active approved member.");
      const [firstDelivery] = await tx.query<{ date: string | null }>(
        "SELECT to_char(min(received_on),'YYYY-MM-DD') AS date FROM chemical_deliveries WHERE order_id=$1",
        [id],
      );
      if (
        input.orderedOn > today() ||
        (firstDelivery.date && input.orderedOn > firstDelivery.date) ||
        (input.expectedOn && input.expectedOn < input.orderedOn)
      )
        fail(400, "Check the order and expected delivery dates.");
      await tx.query(
        `UPDATE chemical_orders SET status=CASE WHEN status='requested' THEN 'ordered' ELSE status END,supplier=$2,ordered_by=$3,ordered_on=$4,expected_on=$5,cost_paise=$6,reference=$7,version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.supplier,
          input.orderedBy,
          input.orderedOn,
          input.expectedOn,
          input.costPaise,
          input.reference,
        ],
      );
      await event(
        tx,
        u,
        await row(tx, id),
        r.status === "requested" ? "ordered" : "order_updated",
        r,
      );
    });
    res.json(await detail(db, id));
  });
  app.post("/api/orders/:id/receive", approved, async (req, res) => {
    const input = receiveSchema.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const { u, r } = await permitted(tx, res, id, input.version);
      if (!["ordered", "part_received"].includes(r.status))
        fail(409, "Only open ordered requests can receive deliveries.");
      const total =
        Math.round((r.receivedQuantity + input.quantity) * 1000) / 1000;
      if (total > r.quantity)
        fail(400, "Delivery exceeds the remaining requested quantity.");
      if (input.receivedOn < r.orderedOn! || input.receivedOn > today())
        fail(
          400,
          "Delivery date must be between the order date and today (IST).",
        );
      await tx.query(
        "INSERT INTO chemical_deliveries(id,order_id,received_by,quantity,received_on,notes) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), id, u.id, input.quantity, input.receivedOn, input.notes],
      );
      await tx.query(
        "UPDATE chemical_orders SET received_quantity=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
        [id, total, total === r.quantity ? "received" : "part_received"],
      );
      await event(tx, u, await row(tx, id), "delivery", r, input.notes);
    });
    res.json(await detail(db, id));
  });
  app.post("/api/orders/:id/cancel", approved, async (req, res) => {
    const input = cancelSchema.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const { u, r } = await permitted(tx, res, id, input.version);
      if (["received", "cancelled"].includes(r.status))
        fail(409, "This request is already closed.");
      await tx.query(
        "UPDATE chemical_orders SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      await event(tx, u, await row(tx, id), "cancelled", r, input.reason);
    });
    res.json(await detail(db, id));
  });
}
