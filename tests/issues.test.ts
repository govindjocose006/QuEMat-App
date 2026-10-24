import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.js";
import {
  openDatabase,
  migrate,
  seed,
  instruments,
  type DB,
} from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import {
  issueSchema,
  issueCategories,
  type IssueDetail,
} from "../shared/issues.js";
const origin = "http://localhost:5173",
  password = "Issues-synthetic-only-passphrase!";
let db: DB,
  app: ReturnType<typeof createApp>,
  ids: Record<string, string>,
  instrumentId: string,
  sampleId: string;
async function client(key = "reporter", target = app) {
  const agent = request.agent(target);
  let csrf = (await agent.get("/api/session")).body.csrfToken;
  const c = {
    get: (path: string) => agent.get("/api" + path),
    write: async (
      path: string,
      data: unknown = {},
      method: "post" | "put" = "post",
    ) => {
      const r = await agent[method]("/api" + path)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data as object);
      if (r.body.csrfToken) csrf = r.body.csrfToken;
      return r;
    },
  };
  const r = await c.write("/auth/login", {
    email: `${key}@example.test`,
    password,
  });
  expect(r.status, r.body.error).toBe(200);
  return c;
}
type Client = Awaited<ReturnType<typeof client>>;
function input(extra: Record<string, unknown> = {}) {
  return {
    title: "Synthetic helium observation",
    description: "Manual observation; request a refill decision.",
    category: "helium_refill",
    priority: "urgent",
    dueDate: "2026-11-02",
    instrumentId,
    sampleId,
    project: "Synthetic magnetism",
    assigneeId: ids.assignee,
    supervisorAttention: true,
    dataLinks: [
      { label: "Observation", url: "https://example.test/shared-observation" },
    ],
    ...extra,
  };
}
async function create(c: Client, extra: Record<string, unknown> = {}) {
  const r = await c.write("/issues", input(extra));
  expect(r.status, r.body.error).toBe(201);
  return r.body as IssueDetail;
}
async function status(
  c: Client,
  r: IssueDetail,
  next: string,
  reason = "Synthetic recorded decision",
) {
  const result = await c.write(`/issues/${r.id}/status`, {
    version: r.version,
    status: next,
    reason,
  });
  expect(result.status, result.body.error).toBe(200);
  return result.body as IssueDetail;
}
async function edit(
  c: Client,
  r: IssueDetail,
  extra: Record<string, unknown> = {},
) {
  return c.write(
    `/issues/${r.id}`,
    { ...issueSchema.parse(input()), version: r.version, ...extra },
    "put",
  );
}
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
      "Synthetic Administrator",
    ),
  };
  const [admin] = await db.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=$1",
    [ids.admin],
  );
  for (const [key, role, state, academic] of [
    ["reporter", "member", "approved", "PhD student"],
    ["assignee", "member", "approved", "PhD student"],
    ["other", "member", "approved", "PhD student"],
    ["academic", "member", "approved", "Supervisor"],
    ["mentor", "mentor", "approved", "Postdoc"],
    ["supervisor", "supervisor", "approved", "Supervisor"],
    ["pending", "member", "pending", "PhD student"],
    ["inactive", "member", "inactive", "PhD student"],
  ]) {
    ids[key] = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,academic_role,project,created_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,'Synthetic','2020-01-01T00:00:00Z')",
      [
        ids[key],
        `${key}@example.test`,
        admin.password_hash,
        `Synthetic ${key}`,
        role,
        state,
        academic,
      ],
    );
  }
  app = createApp(db, { origin, authLimit: 1000 });
  instrumentId = (await instruments(db)).find((i) => i.name === "PPMS")!.id;
  const c = await client();
  const s = await c.write("/samples", { compound: "Synthetic FeSe" });
  sampleId = s.body.id;
});
afterAll(() => db.close());
it("blocks anonymous, pending, inactive and incomplete onboarding access to every issue endpoint", async () => {
  const r = await create(await client());
  const paths = [
    "/issues",
    "/issues/options",
    "/issues/summary",
    `/issues/${r.id}`,
  ];
  for (const path of paths)
    expect((await request(app).get("/api" + path)).status).toBe(401);
  for (const key of ["pending", "inactive"]) {
    if (key === "inactive")
      await db.query("UPDATE users SET status='approved' WHERE id=$1", [
        ids[key],
      ]);
    const c = await client(key);
    if (key === "inactive")
      await db.query("UPDATE users SET status='inactive' WHERE id=$1", [
        ids[key],
      ]);
    for (const path of paths)
      expect((await c.get(path)).status).toBe(key === "inactive" ? 401 : 403);
    expect((await c.write("/issues", input())).status).toBe(
      key === "inactive" ? 401 : 403,
    );
  }
  const c = await client("other");
  await expect(
    db.query("UPDATE users SET onboarded=0 WHERE id=$1", [ids.other]),
  ).rejects.toThrow();
  await db.query("UPDATE users SET status='pending',onboarded=0 WHERE id=$1", [
    ids.other,
  ]);
  expect((await c.get("/issues")).status).toBe(403);
});
it("records reporter, links and open history; attention requested does not acknowledge", async () => {
  const r = await create(await client());
  expect(r.reporterId).toBe(ids.reporter);
  expect(r.status).toBe("open");
  expect(r.acknowledgedBy).toBeNull();
  expect(r.resolvedBy).toBeNull();
  expect(r.code).toMatch(/^ISS-\d+$/);
  expect(r.sampleCode).toMatch(/^QEM-/);
  expect(r.events).toHaveLength(1);
  expect(r.events[0].actorId).toBe(ids.reporter);
  expect(r.events[0].after.dataLinks).toHaveLength(1);
  for (const key of ["assignee", "supervisor", "admin"]) {
    const c = await client(key);
    const notifications = (await c.get("/notifications")).body.filter(
      (n: { issueId: string }) => n.issueId === r.id,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain("not yet acknowledged");
  }
  expect(
    (await (await client("other")).get("/notifications")).body,
  ).toHaveLength(0);
});
it("validates dates, categories, priorities, links and immutable server-owned fields", async () => {
  const c = await client();
  for (const extra of [
    { dueDate: "2026-02-30" },
    { category: "invented" },
    { priority: "critical" },
    { reporterId: ids.admin },
    { status: "resolved" },
    { acknowledgedBy: ids.admin },
    { dataLinks: [{ label: "Unsafe", url: "javascript:alert(1)" }] },
    {
      dataLinks: [
        { label: "Credentials", url: "https://name:secret@example.test/data" },
      ],
    },
  ])
    expect((await c.write("/issues", input(extra))).status).toBe(400);
  for (const extra of [
    { assigneeId: ids.pending },
    { assigneeId: ids.inactive },
    { instrumentId: randomUUID() },
    { sampleId: randomUUID() },
  ])
    expect((await c.write("/issues", input(extra))).status).toBe(400);
  expect((await db.query("SELECT id FROM issues")).length).toBe(0);
});
it("enforces reporter/assignee/staff permissions independently of academic and mentor roles", async () => {
  const c = await client(),
    r = await create(c);
  for (const key of ["other", "academic", "mentor"]) {
    const u = await client(key);
    expect((await u.get(`/issues/${r.id}`)).status).toBe(200);
    expect((await edit(u, r)).status).toBe(403);
    expect(
      (await u.write(`/issues/${r.id}/comments`, { body: "Not assigned here" }))
        .status,
    ).toBe(403);
    expect(
      (
        await u.write(`/issues/${r.id}/status`, {
          version: r.version,
          status: "acknowledged",
          reason: "Attempted acknowledgement",
        })
      ).status,
    ).toBe(403);
  }
  expect((await edit(await client("assignee"), r)).status).toBe(403);
  expect(
    (
      await c.write(`/issues/${r.id}/status`, {
        version: r.version,
        status: "acknowledged",
        reason: "Reporter is not assignee",
      })
    ).status,
  ).toBe(403);
  for (const key of ["reporter", "assignee", "supervisor", "admin"])
    expect(
      (
        await (
          await client(key)
        ).write(`/issues/${r.id}/comments`, {
          body: `Synthetic ${key} follow-up`,
        })
      ).status,
    ).toBe(201);
});
it("preserves explicit acknowledgement, resolution and reopening status history", async () => {
  const c = await client(),
    a = await client("assignee");
  let r = await create(c);
  r = await status(a, r, "acknowledged");
  const ack = r.acknowledgedAt;
  r = await status(a, r, "in_progress");
  r = await status(a, r, "blocked", "Awaiting manual refill decision");
  r = await status(
    await client("supervisor"),
    r,
    "resolved",
    "Decision recorded; no automatic ordering",
  );
  const resolved = r.resolvedAt;
  expect(r.acknowledgedBy).toBe(ids.assignee);
  expect(r.resolvedBy).toBe(ids.supervisor);
  expect(r.events.map((e) => e.toStatus)).toEqual([
    "open",
    "acknowledged",
    "in_progress",
    "blocked",
    "resolved",
  ]);
  r = await status(c, r, "open", "Reopened for a follow-up observation");
  expect(r.acknowledgedAt).toBe(ack);
  expect(r.resolvedAt).toBe(resolved);
  r = await status(await client("admin"), r, "acknowledged");
  expect(r.acknowledgedBy).toBe(ids.assignee);
  expect(r.events.at(-1)!.actorId).toBe(ids.admin);
  const fresh = (await c.get(`/issues/${r.id}`)).body;
  expect(fresh.events).toHaveLength(7);
  expect(fresh.events[4].actorId).toBe(ids.supervisor);
});
it("allows omitted, empty, whitespace and short status reasons while retaining history", async () => {
  const c = await client(),
    a = await client("assignee");
  let r = await create(c);
  const steps = [
    { status: "acknowledged" },
    { status: "in_progress", reason: "" },
    { status: "blocked", reason: "   " },
    { status: "resolved", reason: " OK " },
  ];
  for (const step of steps) {
    const result = await a.write(`/issues/${r.id}/status`, {
      version: r.version,
      ...step,
    });
    expect(result.status, result.body.error).toBe(200);
    r = result.body;
    const event = r.events.at(-1)!;
    expect(event.reason).toBe(step.reason?.trim() ?? "");
    expect(event.actorId).toBe(ids.assignee);
    expect(event.createdAt).toBeTruthy();
    expect(event.toStatus).toBe(step.status);
  }
  const fresh = (await c.get(`/issues/${r.id}`)).body as IssueDetail;
  expect(fresh.events).toEqual(r.events);
  expect(fresh.status).toBe("resolved");
  expect(fresh.acknowledgedAt).toBeTruthy();
  expect(fresh.resolvedAt).toBeTruthy();
});
it("keeps status validation, permissions and stale-version checks without a reason", async () => {
  const c = await client(),
    a = await client("assignee"),
    other = await client("other");
  const r = await create(c);
  const path = `/issues/${r.id}/status`;
  for (const reason of [null, 12, "x".repeat(2001)]) {
    expect(
      (
        await a.write(path, {
          version: r.version,
          status: "acknowledged",
          reason,
        })
      ).status,
    ).toBe(400);
  }
  expect(
    (await other.write(path, { version: r.version, status: "acknowledged" }))
      .status,
  ).toBe(403);
  expect(
    (await a.write(path, { version: r.version, status: "resolved" })).status,
  ).toBe(403);
  expect(
    (await a.write(path, { version: r.version, status: "acknowledged" }))
      .status,
  ).toBe(200);
  expect(
    (await a.write(path, { version: r.version, status: "in_progress" })).status,
  ).toBe(409);
});
it("rejects skipped transitions, stale versions and simultaneous status requests without duplicate notifications", async () => {
  const c = await client(),
    a = await client("assignee"),
    r = await create(c);
  expect(
    (
      await a.write(`/issues/${r.id}/status`, {
        version: r.version,
        status: "resolved",
        reason: "Cannot skip acknowledgement",
      })
    ).status,
  ).toBe(403);
  const results = await Promise.all([
    a.write(`/issues/${r.id}/status`, {
      version: r.version,
      status: "acknowledged",
      reason: "Concurrent acknowledgement one",
    }),
    a.write(`/issues/${r.id}/status`, {
      version: r.version,
      status: "acknowledged",
      reason: "Concurrent acknowledgement two",
    }),
  ]);
  expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
  expect((await c.get(`/issues/${r.id}`)).body.events).toHaveLength(2);
  const notices = (await c.get("/notifications")).body.filter(
    (n: { issueId: string }) => n.issueId === r.id,
  );
  expect(notices).toHaveLength(1);
  expect((await edit(c, r, { title: "Stale detail change" })).status).toBe(409);
});
it("retains metadata snapshots, reassignment history, discussion links and correct notification recipients", async () => {
  const c = await client();
  let r = await create(c);
  const old = r;
  const changed = await edit(c, r, {
    title: "Reassigned synthetic work",
    assigneeId: ids.other,
    supervisorAttention: false,
  });
  expect(changed.status).toBe(200);
  r = changed.body;
  expect(r.events[1].before!.assigneeId).toBe(ids.assignee);
  expect(r.events[1].after.assigneeId).toBe(ids.other);
  expect(r.events[0].after.title).toBe(old.title);
  expect(
    (
      await (
        await client("assignee")
      ).write(`/issues/${r.id}/comments`, {
        body: "Former assignee is no longer participant",
      })
    ).status,
  ).toBe(403);
  const other = await client("other");
  const comment = await other.write(`/issues/${r.id}/comments`, {
    body: "New assigned follow-up",
    dataLinks: [{ label: "Decision", url: "https://example.test/decision" }],
  });
  expect(comment.status).toBe(201);
  expect(comment.body.comments[0].authorId).toBe(ids.other);
  const recreated = createApp(db, { origin, authLimit: 1000 }),
    fresh = await client("reporter", recreated);
  expect(
    (await fresh.get(`/issues/${r.id}`)).body.comments[0].dataLinks,
  ).toHaveLength(1);
  for (const key of ["assignee", "other", "supervisor"])
    expect(
      (await (await client(key)).get("/notifications")).body.some(
        (n: { message: string }) =>
          n.message.includes("details / assignment updated"),
      ),
    ).toBe(true);
});
it("keeps resolved work out of default view and filters literally by every supported dimension", async () => {
  const c = await client(),
    a = await client("assignee");
  let r = await create(c, { title: "Manual helium 100% observation" });
  await create(c, {
    title: "Separate normal maintenance",
    category: "consumables_maintenance",
    priority: "normal",
    instrumentId: null,
    assigneeId: null,
    supervisorAttention: false,
  });
  const match = await c.get(
    `/issues?q=100%25&priority=urgent&category=helium_refill&instrument=${instrumentId}&assignee=${ids.assignee}&status=open`,
  );
  expect(match.status, match.body.error).toBe(200);
  expect(match.body.items.map((i: IssueDetail) => i.id)).toEqual([r.id]);
  expect((await a.get("/issues?assignee=me")).body.total).toBe(1);
  expect((await c.get("/issues?assignee=unassigned")).body.total).toBe(1);
  r = await status(a, r, "acknowledged");
  r = await status(a, r, "resolved");
  expect((await c.get("/issues")).body.total).toBe(1);
  expect((await c.get("/issues?view=resolved")).body.items[0].id).toBe(r.id);
  expect((await c.get("/issues?view=all")).body.total).toBe(2);
  expect((await c.get("/issues?category=bad")).status).toBe(400);
  expect((await c.get("/issues?offset=-1")).status).toBe(400);
});
it("shows urgent, assigned and staff-directed dashboard counts without exposing privileged summaries to academic supervisors", async () => {
  const c = await client();
  let r = await create(c);
  await create(c, {
    title: "Normal supervisor decision",
    priority: "normal",
    assigneeId: null,
  });
  const a = await client("assignee"),
    m = (await a.get("/issues/summary")).body;
  expect(m.counts).toEqual({ urgent: 1, assigned: 1, supervisor: 0 });
  expect(m.supervisor).toEqual([]);
  const s = (await (await client("supervisor")).get("/issues/summary")).body;
  expect(s.counts.supervisor).toBe(2);
  const academic = (await (await client("academic")).get("/issues/summary"))
    .body;
  expect(academic.counts.supervisor).toBe(0);
  r = await status(a, r, "acknowledged");
  await status(a, r, "resolved");
  expect((await a.get("/issues/summary")).body.counts.urgent).toBe(0);
});
it("preserves archived relations and inactive assignees, but refuses new assignment to them", async () => {
  const c = await client();
  let r = await create(c);
  await db.query("UPDATE samples SET archived=true WHERE id=$1", [sampleId]);
  await db.query("UPDATE instruments SET archived=1 WHERE id=$1", [
    instrumentId,
  ]);
  await db.query("UPDATE users SET status='inactive' WHERE id=$1", [
    ids.assignee,
  ]);
  const changed = await edit(c, r, {
    description: "Updated observation with retained historical links",
  });
  expect(changed.status, changed.body.error).toBe(200);
  r = changed.body;
  expect(r.sampleId).toBe(sampleId);
  expect(r.instrumentId).toBe(instrumentId);
  expect(r.assigneeId).toBe(ids.assignee);
  expect((await c.write("/issues", input())).status).toBe(400);
  const options = (await c.get("/issues/options")).body;
  expect(
    options.people.find((p: { id: string }) => p.id === ids.assignee).active,
  ).toBe(false);
});
it("retains append-only comments/events and immutable identity; notification sources stay exclusive", async () => {
  const c = await client(),
    r = await create(c);
  await c.write(`/issues/${r.id}/comments`, { body: "Retain this decision" });
  for (const sql of [
    "UPDATE issue_events SET reason='changed'",
    "DELETE FROM issue_events",
    "UPDATE issue_comments SET body='changed'",
    "DELETE FROM issue_comments",
    "UPDATE issues SET reporter_id='forged'",
    "DELETE FROM issues",
  ])
    await expect(db.exec(sql)).rejects.toThrow();
  const a = await client("assignee"),
    n = (await a.get("/notifications")).body[0];
  expect((await c.write(`/notifications/${n.id}/read`)).status).toBe(404);
  expect((await a.write(`/notifications/${n.id}/read`)).status).toBe(200);
  await expect(
    db.query(
      "INSERT INTO notifications(id,user_id,event_key,message) VALUES($1,$2,'no-source','No source')",
      [randomUUID(), ids.reporter],
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.query("SELECT action FROM audit_events WHERE entity_id=$1", [
        r.id,
      ])
    ).map((x) => x.action),
  ).toEqual(["issue.created", "issue.comment_added"]);
});
it("covers all requested categories without granting purchase or instrument-control capabilities", async () => {
  const c = await client();
  for (const category of Object.keys(issueCategories))
    expect(
      (await create(c, { category, title: `Synthetic ${category}` })).category,
    ).toBe(category);
  expect((await c.get("/issues?view=all")).body.total).toBe(7);
});
it("applies 004 additively over populated 003 and preserves earlier notifications/revision records", async () => {
  const isolated = await openDatabase({ localPath: ":memory:" });
  try {
    await isolated.exec(
      "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
    );
    for (const name of [
      "001_foundation.sql",
      "002_scheduling.sql",
      "003_weekly_progress.sql",
    ]) {
      await isolated.exec(readFileSync("server/migrations/" + name, "utf8"));
      await isolated.query("INSERT INTO schema_migrations VALUES($1,now())", [
        name,
      ]);
    }
    await seed(isolated);
    const u = await bootstrapAdmin(
        isolated,
        "migration@example.test",
        password,
        "Synthetic retained admin",
      ),
      sample = randomUUID(),
      report = randomUUID(),
      booking = randomUUID(),
      instrument = (await instruments(isolated))[0].id;
    await isolated.query(
      "INSERT INTO samples(id,owner_id,compound,origin) VALUES($1,$2,'Retained synthetic','internal')",
      [sample, u],
    );
    await isolated.query(
      "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,actual_start,actual_end) VALUES($1,$2,$3,$3,'booking','completed','2026-10-20T10:00Z','2026-10-20T11:00Z','Synthetic usage','2026-10-20T10:05Z','2026-10-20T10:55Z')",
      [booking, instrument, u],
    );
    await isolated.query("INSERT INTO booking_samples VALUES($1,$2)", [
      booking,
      sample,
    ]);
    await isolated.query(
      "INSERT INTO weekly_reports(id,owner_id,week_start,draft,latest_revision) VALUES($1,$2,'2026-10-19','{}',1)",
      [report, u],
    );
    await isolated.query(
      'INSERT INTO weekly_revisions(report_id,revision,content) VALUES($1,1,\'{"results":"Synthetic retained revision"}\')',
      [report],
    );
    for (const [field, id, key] of [
      ["booking_id", booking, "booking"],
      ["weekly_report_id", report, "weekly"],
    ])
      await isolated.query(
        `INSERT INTO notifications(id,user_id,${field},event_key,message) VALUES($1,$2,$3,$4,'Retained synthetic notification')`,
        [randomUUID(), u, id, key],
      );
    const tables = [
      "users",
      "instruments",
      "samples",
      "bookings",
      "booking_samples",
      "notifications",
      "weekly_reports",
      "weekly_revisions",
      "audit_events",
    ];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (await isolated.query(`SELECT * FROM ${table}`)).map((x) => {
              const r = { ...x };
              for (const column of ["issue_id", "meeting_id", "notice_id"]) {
                if (column in r) expect(r[column]).toBeNull();
                delete r[column];
              }
              return r;
            }),
          ]),
        ),
      );
    const before = await snapshot();
    await migrate(isolated);
    expect(await snapshot()).toEqual(before);
    expect((await isolated.query("SELECT id FROM issues")).length).toBe(0);
    await migrate(isolated);
    expect(await snapshot()).toEqual(before);
    expect(
      (await isolated.query("SELECT name FROM schema_migrations")).length,
    ).toBe(5);
  } finally {
    await isolated.close();
  }
}, 20000);
