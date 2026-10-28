import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
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
  reportSchema,
  emptyReport,
  weekStart,
  weekBounds,
  weekSchema,
} from "../shared/weekly.js";
const origin = "http://localhost:5173",
  password = "Weekly-synthetic-tests-only!",
  week = "2026-10-19";
let db: DB, app: ReturnType<typeof createApp>, ids: Record<string, string>;
async function client(key = "member", target = app) {
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
async function historicalBooking(c: Client, data: unknown) {
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse("2026-10-17T00:00:00Z"));
  try {
    return await c.write("/bookings", data);
  } finally {
    clock.mockRestore();
  }
}
const full = (more: Record<string, unknown> = {}) => ({
  ...emptyReport,
  project: "Magnetism",
  workCompleted: "Prepared FeSe",
  experiments: "No measurement claimed",
  results: "Calibration observations",
  blockers: "None",
  nextPlan: "Repeat calibration",
  helpNeeded: "Review configuration",
  ...more,
});
async function draft(c: Client, content = full(), selectedWeek = week) {
  const r = await c.write("/weekly/reports", { week: selectedWeek, content });
  expect(r.status, r.body.error).toBe(201);
  return r.body;
}
async function submit(c: Client, r: { id: string; version: number }) {
  const p = await c.write(`/weekly/reports/${r.id}/preview`, {
    version: r.version,
  });
  expect(p.status, p.body.error).toBe(200);
  const result = await c.write(`/weekly/reports/${r.id}/submit`, {
    version: r.version,
    reviewDigest: p.body.reviewDigest,
  });
  expect(result.status, result.body.error).toBe(200);
  return result.body;
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
      "Synthetic Admin",
    ),
  };
  const [admin] = await db.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=$1",
    [ids.admin],
  );
  for (const [key, role, status, academic] of [
    ["member", "member", "approved", "Intern"],
    ["other", "member", "approved", "PhD student"],
    ["mentor", "mentor", "approved", "PhD student"],
    ["supervisor", "supervisor", "approved", "Supervisor"],
    ["academic", "member", "approved", "Supervisor"],
    ["pending", "member", "pending", "PhD student"],
    ["inactive", "member", "inactive", "PhD student"],
  ]) {
    ids[key] = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,academic_role,project,created_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,'Magnetism','2020-01-01T00:00:00Z')",
      [
        ids[key],
        `${key}@example.test`,
        admin.password_hash,
        `Synthetic ${key}`,
        role,
        status,
        academic,
      ],
    );
  }
  await db.query("UPDATE users SET mentor_id=$1 WHERE id=$2", [
    ids.mentor,
    ids.member,
  ]);
  app = createApp(db, { origin, authLimit: 1000 });
});
afterAll(async () => {
  await db.close();
});
it("uses Kolkata Monday boundaries including UTC Sunday, year changes and leap days", () => {
  expect(weekStart("2026-10-18T18:29:59.999Z")).toBe("2026-10-12");
  expect(weekStart("2026-10-18T18:30:00.000Z")).toBe(week);
  expect(weekStart("2027-01-01T00:00:00Z")).toBe("2026-12-28");
  expect(weekStart("2024-02-29T20:00:00Z")).toBe("2024-02-26");
  expect(weekBounds(week)).toEqual([
    "2026-10-18T18:30:00.000Z",
    "2026-10-25T18:30:00.000Z",
  ]);
  expect(weekSchema.safeParse("2026-10-20").success).toBe(false);
});
it("keeps drafts private, submits immutable snapshots and retains first timestamp across revisions", async () => {
  const c = await client(),
    s = await client("supervisor");
  let r = await draft(c);
  expect((await s.get(`/weekly/reports/${r.id}`)).status).toBe(404);
  r = await submit(c, r);
  const first = r.firstSubmittedAt;
  const saved = await c.write(
    `/weekly/reports/${r.id}`,
    {
      version: r.version,
      content: full({ results: "Private revision draft" }),
    },
    "put",
  );
  expect(saved.status).toBe(200);
  const visible = (await s.get(`/weekly/reports/${r.id}`)).body;
  expect(visible.draft).toBeUndefined();
  expect(JSON.stringify(visible)).not.toContain("Private revision draft");
  expect(visible.revisions[0].content.results).toBe("Calibration observations");
  r = await submit(c, saved.body);
  expect(r.revisions).toHaveLength(2);
  expect(r.firstSubmittedAt).toBe(first);
  expect(r.revisions[1].content.results).toBe("Calibration observations");
  await expect(
    db.query("UPDATE weekly_revisions SET content='{}' WHERE report_id=$1", [
      r.id,
    ]),
  ).rejects.toThrow("append only");
  await expect(
    db.query("DELETE FROM weekly_revisions WHERE report_id=$1", [r.id]),
  ).rejects.toThrow("append only");
});
it("allows incomplete drafts but requires all sections and review digest for submission", async () => {
  const c = await client(),
    r = await draft(c, { ...emptyReport });
  expect(
    (await c.write(`/weekly/reports/${r.id}/preview`, { version: r.version }))
      .status,
  ).toBe(400);
  expect(
    (await c.write(`/weekly/reports/${r.id}/submit`, { version: r.version }))
      .status,
  ).toBe(400);
  const ready = await c.write(
    `/weekly/reports/${r.id}`,
    { version: r.version, content: full() },
    "put",
  );
  expect(
    (
      await c.write(`/weekly/reports/${r.id}/submit`, {
        version: ready.body.version,
        reviewDigest: "0".repeat(64),
      })
    ).status,
  ).toBe(409);
  expect(
    (await c.write("/weekly/reports", { week: "2099-01-05", content: full() }))
      .status,
  ).toBe(400);
});
it("rejects cross-owner edits, academic-role escalation, pending access and unrelated mentors", async () => {
  const c = await client(),
    r = await submit(c, await draft(c));
  for (const key of ["other", "academic", "mentor", "admin"]) {
    const x = await client(key);
    expect((await x.get(`/weekly/reports/${r.id}`)).status).toBe(404);
    expect((await x.get(`/weekly/review?week=${week}`)).status).toBe(403);
    expect(
      (
        await x.write(
          `/weekly/reports/${r.id}`,
          { version: r.version, content: full() },
          "put",
        )
      ).status,
    ).toBe(403);
    expect(
      (await x.write(`/weekly/reports/${r.id}/review`, { revision: 1 })).status,
    ).toBe(403);
  }
  const pending = await client("pending");
  expect((await pending.get(`/weekly/mine?week=${week}`)).status).toBe(403);
  const mentor = await client("mentor");
  expect((await mentor.get(`/weekly/reports/${r.id}`)).status).toBe(404);
  const other = await client("other"),
    otherReport = await submit(other, await draft(other));
  expect((await mentor.get(`/weekly/reports/${otherReport.id}`)).status).toBe(
    404,
  );
  await db.query("UPDATE users SET mentor_id=NULL WHERE id=$1", [ids.member]);
  expect((await mentor.get(`/weekly/reports/${r.id}`)).status).toBe(404);
  expect(
    (await mentor.write(`/weekly/reports/${r.id}/review`, { revision: 1 }))
      .status,
  ).toBe(403);
});
it("filters submitted/missing eligible members without exposing draft content or inactive missing members", async () => {
  const c = await client(),
    a = await client("supervisor"),
    m = await client("mentor");
  await draft(c, full({ project: "Private draft project" }));
  let rows = (await a.get(`/weekly/review?week=${week}`)).body;
  expect(rows.find((p: { id: string }) => p.id === ids.member).status).toBe(
    "missing",
  );
  expect(JSON.stringify(rows)).not.toContain("Private draft project");
  expect(
    rows.some((p: { id: string }) =>
      [ids.inactive, ids.pending, ids.admin, ids.supervisor].includes(p.id),
    ),
  ).toBe(false);
  expect(rows.some((p: { id: string }) => p.id === ids.academic)).toBe(true);
  const r = (await c.get(`/weekly/mine?week=${week}`)).body;
  await submit(c, r);
  rows = (
    await a.get(
      `/weekly/review?week=${week}&person=${ids.member}&project=private`,
    )
  ).body;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("submitted");
  expect((await m.get(`/weekly/review?week=${week}`)).status).toBe(403);
  await db.query("UPDATE users SET status='inactive' WHERE id=$1", [
    ids.member,
  ]);
  rows = (await a.get(`/weekly/review?week=${week}&person=${ids.member}`)).body;
  expect(rows[0].active).toBe(false);
  expect(rows[0].eligible).toBe(false);
  expect(rows[0].status).toBe("submitted");
  expect((await a.get("/weekly/review?week=2019-12-23")).body).toHaveLength(0);
});
it("supports revision-bound review, comments, replies and follow-up history with notifications", async () => {
  const c = await client(),
    m = await client("mentor"),
    s = await client("supervisor"),
    r = await submit(c, await draft(c));
  expect(
    (await c.write(`/weekly/reports/${r.id}/review`, { revision: 1 })).status,
  ).toBe(403);
  let response = await s.write(`/weekly/reports/${r.id}/comments`, {
    revision: 1,
    kind: "followup",
    body: "Check calibration",
    dueDate: "2026-10-30",
  });
  expect(response.status).toBe(200);
  const action = response.body.comments[0];
  expect(response.body.actionEvents).toHaveLength(1);
  expect(
    (
      await c.write(`/weekly/reports/${r.id}/comments`, {
        revision: 1,
        kind: "followup",
        body: "Self assign",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await c.write(`/weekly/reports/${r.id}/comments`, {
        revision: 1,
        kind: "comment",
        body: "Acknowledged",
      })
    ).status,
  ).toBe(200);
  response = await c.write(`/weekly/reports/${r.id}/actions/${action.id}`, {
    version: action.version,
    state: "done",
  });
  expect(response.status).toBe(200);
  expect(response.body.actionEvents).toHaveLength(2);
  expect(
    (
      await c.write(`/weekly/reports/${r.id}/actions/${action.id}`, {
        version: action.version,
        state: "open",
      })
    ).status,
  ).toBe(409);
  expect(
    (await s.write(`/weekly/reports/${r.id}/review`, { revision: 1 })).status,
  ).toBe(200);
  expect(
    (await s.write(`/weekly/reports/${r.id}/review`, { revision: 1 })).status,
  ).toBe(200);
  expect((await db.query("SELECT * FROM weekly_reviews")).length).toBe(1);
  const notifications = (await c.get("/notifications")).body;
  expect(
    notifications.some(
      (n: { weeklyReportId: string }) => n.weeklyReportId === r.id,
    ),
  ).toBe(true);
  expect(
    (
      await db.query(
        "SELECT 1 FROM notifications WHERE user_id=$1 AND event_key LIKE '%reviewed%'",
        [ids.member],
      )
    ).length,
  ).toBe(1);
  await expect(
    db.query("UPDATE weekly_comments SET body='Changed' WHERE id=$1", [
      action.id,
    ]),
  ).rejects.toThrow("immutable");
  expect((await c.get("/weekly/summary")).body.openActions).toBe(0);
  const revised = await c.write(
    `/weekly/reports/${r.id}`,
    { version: r.version, content: full({ results: "Revised findings" }) },
    "put",
  );
  await submit(c, revised.body);
  const roster = (
    await s.get(`/weekly/review?week=${week}&person=${ids.member}`)
  ).body;
  expect(roster[0].reviewed).toBe(false);
});
it("protects drafts and submission from simultaneous requests and stale edits", async () => {
  const c = await client();
  const creates = await Promise.all([
    c.write("/weekly/reports", { week, content: full() }),
    c.write("/weekly/reports", { week, content: full() }),
  ]);
  expect(creates.map((r) => r.status).sort()).toEqual([201, 409]);
  const r = creates.find((r) => r.status === 201)!.body,
    p = (
      await c.write(`/weekly/reports/${r.id}/preview`, { version: r.version })
    ).body;
  const submitted = await Promise.all(
    [1, 2].map(() => c.write(`/weekly/reports/${r.id}/submit`, p)),
  );
  expect(submitted.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await db.query("SELECT * FROM weekly_revisions")).length).toBe(1);
  expect(
    (
      await c.write(
        `/weekly/reports/${r.id}`,
        { version: r.version, content: full() },
        "put",
      )
    ).status,
  ).toBe(409);
});
it("snapshots only relevant selected records, validates source changes and preserves scheduled/actual distinction", async () => {
  const c = await client(),
    other = await client("other");
  const sample = (
    await c.write("/samples", { compound: "FeSe", origin: "internal" })
  ).body;
  const foreign = (
    await other.write("/samples", { compound: "Foreign", origin: "internal" })
  ).body;
  const instrument = (await instruments(db)).find((i) => i.name === "PPMS")!;
  const b = (
    await historicalBooking(c, {
      instrumentId: instrument.id,
      operatorId: ids.member,
      sampleIds: [sample.id],
      measurementType: "M(T)",
      startsAt: "2026-10-20T03:00:00Z",
      endsAt: "2026-10-20T04:00:00Z",
      details: {},
    })
  ).body;
  expect(b.id).toBeTruthy();
  expect(
    (
      await c.write("/weekly/reports", {
        week,
        content: full({ sampleIds: [foreign.id] }),
      })
    ).status,
  ).toBe(400);
  let r = await draft(c, full({ sampleIds: [sample.id], bookingIds: [b.id] }));
  let p = (
    await c.write(`/weekly/reports/${r.id}/preview`, { version: r.version })
  ).body;
  await db.query("UPDATE samples SET compound='Updated compound' WHERE id=$1", [
    sample.id,
  ]);
  expect((await c.write(`/weekly/reports/${r.id}/submit`, p)).status).toBe(409);
  r = await submit(c, r);
  expect(r.revisions[0].content.bookings[0].actualStart).toBeNull();
  expect(r.revisions[0].content.bookings[0].status).toBe("confirmed");
  await db.query("UPDATE samples SET compound='Later change' WHERE id=$1", [
    sample.id,
  ]);
  expect(
    (await c.get(`/weekly/reports/${r.id}`)).body.revisions[0].content
      .samples[0].compound,
  ).toBe("Updated compound");
  const nextWeek = (await c.get("/weekly/sources?week=2026-10-26")).body;
  expect(nextWeek.bookings).toHaveLength(0);
});
it("keeps half-open booking boundaries and participant access in the selected week", async () => {
  const c = await client(),
    other = await client("other"),
    s = (
      await c.write("/samples", {
        compound: "Boundary sample",
        origin: "internal",
      })
    ).body,
    i = (await instruments(db)).find((x) => x.name === "PPMS")!;
  for (const [start, end] of [
    ["2026-10-18T17:30:00Z", "2026-10-18T18:30:00Z"],
    ["2026-10-18T18:30:00Z", "2026-10-18T19:30:00Z"],
    ["2026-10-25T18:30:00Z", "2026-10-25T19:30:00Z"],
  ])
    expect(
      (
        await historicalBooking(c, {
          instrumentId: i.id,
          operatorId: ids.member,
          participantIds: [ids.other],
          sampleIds: [s.id],
          measurementType: "Boundary",
          startsAt: start,
          endsAt: end,
          details: {},
        })
      ).status,
    ).toBe(201);
  const source = (await other.get(`/weekly/sources?week=${week}`)).body;
  expect(source.bookings).toHaveLength(1);
  expect(source.samples.some((x: { id: string }) => x.id === s.id)).toBe(true);
});
it("rejects unsafe data links and duplicate selected records", async () => {
  const c = await client();
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.test/data",
  ])
    expect(
      (
        await c.write("/weekly/reports", {
          week,
          content: full({ dataLinks: [{ label: "Bad", url }] }),
        })
      ).status,
    ).toBe(400);
  const s = (
    await c.write("/samples", { compound: "Duplicate", origin: "internal" })
  ).body;
  expect(
    (
      await c.write("/weekly/reports", {
        week,
        content: full({ sampleIds: [s.id, s.id] }),
      })
    ).status,
  ).toBe(400);
});
it("rechecks reviewer permission after acquiring the write lock", async () => {
  const c = await client(),
    r = await submit(c, await draft(c));
  const wrapped: DB = {
    ...db,
    write: (fn) =>
      db.write(async (tx) => {
        await tx.query("UPDATE users SET app_role='member' WHERE id=$1", [
          ids.supervisor,
        ]);
        return fn(tx);
      }),
  };
  const s = await client(
    "supervisor",
    createApp(wrapped, { origin, authLimit: 1000 }),
  );
  expect(
    (await s.write(`/weekly/reports/${r.id}/review`, { revision: 1 })).status,
  ).toBe(403);
  expect((await db.query("SELECT * FROM weekly_reviews")).length).toBe(0);
});
it("adds Phase 3A without altering existing Phase 1/2 records or booking constraints", async () => {
  const legacy = await openDatabase({ localPath: ":memory:" });
  try {
    await legacy.exec(
      "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
    );
    for (const name of ["001_foundation.sql", "002_scheduling.sql"]) {
      await legacy.exec(readFileSync(`server/migrations/${name}`, "utf8"));
      await legacy.query(
        "INSERT INTO schema_migrations VALUES($1,'synthetic')",
        [name],
      );
    }
    await seed(legacy);
    const id = await bootstrapAdmin(
      legacy,
      "migration@example.test",
      password,
      "Synthetic Migration Admin",
    );
    const instrument = (await instruments(legacy)).find(
      (i) => i.name === "PPMS",
    )!;
    const sampleId = randomUUID(),
      bookingId = randomUUID();
    await legacy.query(
      "INSERT INTO samples(id,owner_id,compound,origin) VALUES($1,$2,'Preserved synthetic sample','internal')",
      [sampleId, id],
    );
    await legacy.query(
      "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,instrument_category,kind,status,starts_at,ends_at,measurement_type) VALUES($1,$2,$3,$3,'PPMS','booking','confirmed','2026-10-20T04:00:00Z','2026-10-20T05:00:00Z','Synthetic preservation check')",
      [bookingId, instrument.id, id],
    );
    await legacy.query(
      "INSERT INTO booking_samples(booking_id,sample_id) VALUES($1,$2)",
      [bookingId, sampleId],
    );
    await legacy.query(
      "INSERT INTO notifications(id,user_id,booking_id,event_key,message) VALUES($1,$2,$3,'synthetic-preservation','Existing booking notification')",
      [randomUUID(), id, bookingId],
    );
    const tables = [
        "users",
        "instruments",
        "training_entries",
        "audit_events",
        "bookings",
        "samples",
        "notifications",
      ],
      before: Record<string, unknown> = {};
    for (const t of tables)
      before[t] = await legacy.query(`SELECT * FROM ${t} ORDER BY id`);
    await migrate(legacy);
    await migrate(legacy);
    for (const t of tables) {
      const after = await legacy.query<Record<string, unknown>>(
        `SELECT * FROM ${t} ORDER BY id`,
      );
      if (t === "notifications")
        after.forEach((r) => {
          expect(r.order_id).toBeNull();
          delete r.order_id;
          expect(r.issue_id).toBeNull();
          expect(r.meeting_id).toBeNull();
          expect(r.notice_id).toBeNull();
          delete r.meeting_id;
          delete r.notice_id;
          delete r.issue_id;
          delete r.weekly_report_id;
        });
      expect(after).toEqual(before[t]);
    }
    expect(
      (await legacy.query("SELECT id FROM users WHERE id=$1", [id])).length,
    ).toBe(1);
    expect(
      (
        await legacy.query(
          "SELECT 1 FROM pg_constraint WHERE conname='bookings_no_overlap'",
        )
      ).length,
    ).toBe(1);
  } finally {
    await legacy.close();
  }
}, 20000);

it("keeps old report notifications private across lists, badges and read actions, including role changes", async () => {
  const c = await client(),
    s = await client("supervisor");
  const r = await submit(c, await draft(c));
  expect((await s.get("/notifications")).body).toHaveLength(0);
  for (const key of ["admin", "mentor", "other", "supervisor"]) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO notifications(id,user_id,weekly_report_id,event_key,message) VALUES($1,$2,$3,$4,'Historical private report notification')",
      [id, ids[key], r.id, `legacy:${key}`],
    );
    const x = await client(key);
    if (key === "supervisor") {
      expect((await x.get("/notifications/page")).body.items).toHaveLength(1);
      await db.query("UPDATE users SET app_role='mentor' WHERE id=$1", [
        ids[key],
      ]);
    }
    expect((await x.get("/notifications")).body).toHaveLength(0);
    expect(
      (await x.get("/notifications/page?unread=true")).body.items,
    ).toHaveLength(0);
    expect((await x.get("/notifications/summary")).body.unreadCount).toBe(0);
    expect((await x.write(`/notifications/${id}/read`)).status).toBe(404);
    expect((await x.get("/weekly/summary")).body.review).toBeNull();
    expect((await x.get(`/weekly/reports/${r.id}`)).status).toBe(404);
    expect(
      (
        await x.write(`/weekly/reports/${r.id}/comments`, {
          revision: 1,
          kind: "comment",
          body: "Not permitted",
        })
      ).status,
    ).toBe(404);
  }
});

it("supervisor can monitor reports from every application role without submission alerts", async () => {
  const s = await client("supervisor");
  for (const key of ["member", "mentor", "admin", "other"]) {
    const c = await client(key),
      r = await submit(c, await draft(c));
    expect((await s.get(`/weekly/reports/${r.id}`)).status).toBe(200);
    expect((await c.get(`/weekly/reports/${r.id}`)).status).toBe(200);
    expect((await c.get("/weekly/summary")).body.review).toBeNull();
  }
  const rows = (await s.get(`/weekly/review?week=${week}`)).body;
  expect(
    rows.filter((x: { status: string }) => x.status === "submitted"),
  ).toHaveLength(4);
  expect((await s.get("/notifications")).body).toHaveLength(0);
});

for (const symbol of ["α", '"', "🧪"])
  it(
    "saves and submits valid reports with large UTF-8 or JSON-escaped content " +
      JSON.stringify(symbol),
    async () => {
      const content = full(
        Object.fromEntries(
          [
            "workCompleted",
            "experiments",
            "results",
            "blockers",
            "nextPlan",
            "helpNeeded",
          ].map((k) => [k, symbol.repeat(6000 / symbol.length)]),
        ),
      );
      expect(reportSchema.safeParse(content).success).toBe(true);
      expect(
        Buffer.byteLength(JSON.stringify({ week, content })),
      ).toBeGreaterThan(65536);
      const c = await client();
      const r = await draft(c, content);
      const updated = await c.write(
        `/weekly/reports/${r.id}`,
        { version: r.version, content },
        "put",
      );
      expect(updated.status).toBe(200);
      const submitted = await submit(c, updated.body);
      expect(submitted.revisions[0].content.results).toBe(content.results);
    },
  );
it("keeps bounded payload limits on report and unrelated endpoints", async () => {
  const c = await client();
  expect(
    (
      await c.write("/weekly/reports", {
        week,
        content: full({ results: "x".repeat(513 * 1024) }),
      })
    ).status,
  ).toBe(413);
  expect(
    (await c.write("/issues", { description: "x".repeat(65 * 1024) })).status,
  ).toBe(413);
  expect(
    (
      await c.write("/weekly/reports", {
        week,
        content: full({ results: "x".repeat(6001) }),
      })
    ).status,
  ).toBe(400);
});

it("rejects database-unsupported report text as a validation error", async () => {
  const c = await client();
  for (const results of ["null\u0000character", "unpaired\ud800surrogate"])
    expect(
      (await c.write("/weekly/reports", { week, content: full({ results }) }))
        .status,
    ).toBe(400);
});
