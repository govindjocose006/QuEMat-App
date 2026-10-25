import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { openDatabase, migrate, seed, type DB } from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { parseRupees } from "../shared/orders.js";
let db: DB, app: ReturnType<typeof createApp>, ids: Record<string, string>;
const origin = "http://localhost:5173",
  password = "Orders-tests-only-password!";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
async function client(key = "member") {
  const a = request.agent(app);
  let csrf = (await a.get("/api/session")).body.csrfToken;
  const c = {
    get: (p: string) => a.get("/api" + p),
    write: async (
      p: string,
      data: object = {},
      method: "post" | "put" = "post",
    ) => {
      const r = await a[method]("/api" + p)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data);
      if (r.body.csrfToken) csrf = r.body.csrfToken;
      return r;
    },
  };
  expect(
    (await c.write("/auth/login", { email: key + "@example.test", password }))
      .status,
  ).toBe(200);
  return c;
}
const fields = {
  chemical: "Synthetic Gd2O3",
  quantity: 10,
  unit: "g",
  purpose: "Synthetic sample preparation",
  estimatedCostPaise: 12345,
};
async function make(c: Awaited<ReturnType<typeof client>>) {
  const r = await c.write("/orders", fields);
  expect(r.status, r.body.error).toBe(201);
  return r.body;
}
const order = (version: number, extra: object = {}) => ({
  version,
  supplier: "Synthetic supplier",
  orderedBy: ids.member,
  orderedOn: today(),
  costPaise: 99901,
  ...extra,
});
beforeAll(async () => {
  db = await openDatabase({ localPath: ":memory:" });
  await migrate(db);
}, 20000);
beforeEach(async () => {
  await db.exec(
    "TRUNCATE users,instruments,audit_events,rate_limits RESTART IDENTITY CASCADE",
  );
  await seed(db);
  ids = {
    admin: await bootstrapAdmin(
      db,
      "admin@example.test",
      password,
      "Administrator",
    ),
  };
  const [a] = await db.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=$1",
    [ids.admin],
  );
  for (const key of ["member", "other", "pending", "supervisor"]) {
    ids[key] = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,created_at) VALUES($1,$2,$3,$4,$5,$6,1,now())",
      [
        ids[key],
        key + "@example.test",
        a.password_hash,
        key,
        key === "supervisor" ? "supervisor" : "member",
        key === "pending" ? "pending" : "approved",
      ],
    );
  }
  app = createApp(db, { origin, authLimit: 1000 });
});
afterAll(() => db.close());
it("tracks a request, actual order and partial deliveries, with notifications, closed views and history", async () => {
  const c = await client();
  let o = await make(c);
  expect(o.code).toMatch(/^ORD-\d+$/);
  expect(o.estimatedCostPaise).toBe(12345);
  o = (await c.write(`/orders/${o.id}/record`, order(o.version))).body;
  expect(o.status).toBe("ordered");
  expect(o.costPaise).toBe(99901);
  o = (
    await c.write(`/orders/${o.id}/receive`, {
      version: o.version,
      quantity: 3.25,
      receivedOn: today(),
      notes: "First package",
    })
  ).body;
  expect(o.status).toBe("part_received");
  o = (
    await c.write(`/orders/${o.id}/receive`, {
      version: o.version,
      quantity: 6.75,
      receivedOn: today(),
    })
  ).body;
  expect(o.status).toBe("received");
  expect(o.receivedQuantity).toBe(10);
  expect(o.events).toHaveLength(4);
  expect(o.deliveries).toHaveLength(2);
  expect(o.deliveries[0].receivedName).toBe("member");
  expect((await c.get("/orders")).body.items).toHaveLength(0);
  expect((await c.get("/orders?view=closed")).body.items[0].id).toBe(o.id);
  const n = (
    await c.get("/notifications/page?path=notifications%2Fpage")
  ).body.items.find((x: { orderId: string }) => x.orderId === o.id);
  expect(n.orderId).toBe(o.id);
  expect((await c.write(`/notifications/${n.id}/read`)).status).toBe(200);
});
it("enforces ownership while allowing shared read access and supervisor management", async () => {
  const c = await client(),
    other = await client("other"),
    sup = await client("supervisor");
  const o = await make(c);
  expect((await other.get("/orders/" + o.id)).status).toBe(200);
  for (const [p, d] of [
    ["record", order(o.version)],
    ["cancel", { version: o.version }],
  ] as const)
    expect((await other.write(`/orders/${o.id}/${p}`, d)).status).toBe(403);
  expect(
    (
      await other.write(
        "/orders/" + o.id,
        { ...fields, version: o.version },
        "put",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await c.write(
        `/orders/${o.id}/record`,
        order(o.version, { orderedBy: ids.other }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await sup.write(
        `/orders/${o.id}/record`,
        order(o.version, { orderedBy: ids.other }),
      )
    ).status,
  ).toBe(200);
});
it("blocks anonymous, pending, revoked and CSRF-less access", async () => {
  const c = await client();
  const o = await make(c);
  const paths = [
    "/orders",
    "/orders/options",
    "/orders/summary",
    "/orders/" + o.id,
  ];
  for (const p of paths)
    expect((await request(app).get("/api" + p)).status).toBe(401);
  const pending = await client("pending");
  for (const p of paths) expect((await pending.get(p)).status).toBe(403);
  expect((await pending.write("/orders", fields)).status).toBe(403);
  expect((await request(app).post("/api/orders").send(fields)).status).not.toBe(
    201,
  );
  await db.query("UPDATE users SET status='inactive' WHERE id=$1", [
    ids.member,
  ]);
  expect([401, 403]).toContain(
    (await c.write(`/orders/${o.id}/cancel`, { version: o.version })).status,
  );
});
it("rejects excess and stale simultaneous deliveries without duplicate history or quantity", async () => {
  const c = await client();
  let o = await make(c);
  o = (await c.write(`/orders/${o.id}/record`, order(o.version))).body;
  const payload = { version: o.version, quantity: 7, receivedOn: today() };
  const results = await Promise.all([
    c.write(`/orders/${o.id}/receive`, payload),
    c.write(`/orders/${o.id}/receive`, payload),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  o = (await c.get("/orders/" + o.id)).body;
  expect(o.receivedQuantity).toBe(7);
  expect(o.deliveries).toHaveLength(1);
  const bad = await c.write(`/orders/${o.id}/receive`, {
    ...payload,
    version: o.version,
    quantity: 4,
  });
  expect(bad.status).toBe(400);
  expect((await c.get("/orders/" + o.id)).body.events).toHaveLength(3);
});
it("retains partial deliveries on cancellation and immutable request identity/history", async () => {
  const c = await client();
  let o = await make(c);
  o = (await c.write(`/orders/${o.id}/record`, order(o.version))).body;
  o = (
    await c.write(`/orders/${o.id}/receive`, {
      version: o.version,
      quantity: 1,
      receivedOn: today(),
    })
  ).body;
  o = (
    await c.write(`/orders/${o.id}/cancel`, {
      version: o.version,
      reason: "Remaining quantity no longer needed",
    })
  ).body;
  expect(o.status).toBe("cancelled");
  expect(o.deliveries).toHaveLength(1);
  expect(
    (
      await c.write(`/orders/${o.id}/receive`, {
        version: o.version,
        quantity: 1,
        receivedOn: today(),
      })
    ).status,
  ).toBe(409);
  for (const sql of [
    "DELETE FROM chemical_orders",
    "UPDATE chemical_order_events SET reason='changed'",
    "DELETE FROM chemical_deliveries",
  ])
    await expect(db.exec(sql)).rejects.toThrow();
  await expect(
    db.query("UPDATE chemical_orders SET requester_id=$2 WHERE id=$1", [
      o.id,
      ids.other,
    ]),
  ).rejects.toThrow();
});
it("allows ordered-cost corrections with history, but preserves received quantity and delivery chronology", async () => {
  const c = await client();
  let o = await make(c);
  o = (
    await c.write(
      `/orders/${o.id}/record`,
      order(o.version, { costPaise: null }),
    )
  ).body;
  o = (
    await c.write(`/orders/${o.id}/receive`, {
      version: o.version,
      quantity: 10,
      receivedOn: today(),
    })
  ).body;
  const corrected = await c.write(
    `/orders/${o.id}/record`,
    order(o.version, { costPaise: 123456, reference: "Invoice synthetic" }),
  );
  expect(corrected.status, corrected.body.error).toBe(200);
  expect(corrected.body.status).toBe("received");
  expect(corrected.body.receivedQuantity).toBe(10);
  expect(corrected.body.events.at(-1).kind).toBe("order_updated");
  expect(corrected.body.events.at(-1).before.costPaise).toBeNull();
  expect(corrected.body.costPaise).toBe(123456);
  expect(
    (
      await c.write(
        "/orders/" + o.id,
        { ...fields, quantity: 20, version: corrected.body.version },
        "put",
      )
    ).status,
  ).toBe(409);
});
it("validates money, quantities, real dates, references and disallowed lifecycle changes", async () => {
  const c = await client();
  for (const extra of [
    { quantity: -1 },
    { quantity: 1.0001 },
    { estimatedCostPaise: 1.5 },
    { chemical: "x" },
    { quantity: Infinity },
    { unit: "unknown" },
  ])
    expect((await c.write("/orders", { ...fields, ...extra })).status).toBe(
      400,
    );
  const o = await make(c);
  expect(
    (
      await c.write(`/orders/${o.id}/receive`, {
        version: o.version,
        quantity: 1,
        receivedOn: today(),
      })
    ).status,
  ).toBe(409);
  for (const extra of [
    { orderedOn: "2035-01-01" },
    { orderedOn: "2026-02-30" },
    { expectedOn: "2000-01-01" },

    { costPaise: -1 },
  ])
    expect(
      (await c.write(`/orders/${o.id}/record`, order(o.version, extra))).status,
    ).toBe(400);
  expect(
    (
      await c.write(
        `/orders/${o.id}/record`,
        order(o.version, { orderedBy: randomUUID() }),
      )
    ).status,
  ).toBe(403);
  const admin = await client("admin");
  expect(
    (
      await admin.write(
        `/orders/${o.id}/record`,
        order(o.version, { orderedBy: randomUUID() }),
      )
    ).status,
  ).toBe(400);
  expect((await c.get("/orders/" + randomUUID())).status).toBe(404);
  expect(parseRupees("0.10")).toBe(10);
  expect(parseRupees("1234.01")).toBe(123401);
  expect(parseRupees("")).toBeNull();
  expect(() => parseRupees("1.001")).toThrow();
});
it("filters and paginates shared orders without hiding older requests", async () => {
  const c = await client();
  for (let i = 0; i < 52; i++)
    await db.query(
      "INSERT INTO chemical_orders(id,requester_id,chemical,quantity,unit,purpose) VALUES($1,$2,$3,1,'g','Synthetic pagination')",
      [
        randomUUID(),
        i === 51 ? ids.other : ids.member,
        i === 51 ? "Unique other reagent" : "Synthetic chemical",
      ],
    );
  const page = await c.get("/orders?path=orders&view=all");
  expect(page.body.items).toHaveLength(50);
  expect(page.body.total).toBe(52);
  const next = await c.get("/orders?view=all&offset=50");
  expect(next.body.items).toHaveLength(2);
  expect(
    new Set(
      [...page.body.items, ...next.body.items].map((x: { id: string }) => x.id),
    ).size,
  ).toBe(52);
  expect((await c.get("/orders?view=mine")).body.total).toBe(51);
  expect((await c.get("/orders?q=Unique")).body.total).toBe(1);
});
it("adds 006 to a populated 001–005 database preserving original records and reruns idempotently", async () => {
  const legacy = await openDatabase({ localPath: ":memory:" });
  try {
    await legacy.exec(
      "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
    );
    for (const name of [
      "001_foundation.sql",
      "002_scheduling.sql",
      "003_weekly_progress.sql",
      "004_issues_requests.sql",
      "005_meetings_notices.sql",
    ]) {
      await legacy.exec(readFileSync("server/migrations/" + name, "utf8"));
      await legacy.query(
        "INSERT INTO schema_migrations VALUES($1,'synthetic')",
        [name],
      );
    }
    await seed(legacy);
    await bootstrapAdmin(
      legacy,
      "preserved@example.test",
      password,
      "Preserved",
    );
    const users = await legacy.query("SELECT * FROM users"),
      ins = await legacy.query("SELECT * FROM instruments");
    await migrate(legacy);
    await migrate(legacy);
    expect(await legacy.query("SELECT * FROM users")).toEqual(users);
    expect(await legacy.query("SELECT * FROM instruments")).toEqual(ins);
    expect(
      (await legacy.query("SELECT name FROM schema_migrations")).length,
    ).toBe(6);
  } finally {
    await legacy.close();
  }
}, 20000);
