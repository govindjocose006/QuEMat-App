// Native PostgreSQL integration test. Never reads DATABASE_URL or .env.
// Creates/drops only a fresh random database on a loopback server.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import request from "supertest";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";
import { migrate, seed, type DB, type SQL } from "../server/db.js";
import {
  applyReviewedPhase3A,
  fingerprints,
  verifyRetained,
} from "../scripts/phase3a-production-release-core.js";
import { inspectReadOnly } from "../scripts/phase3a-release-inspection.js";
import {
  applyReviewedPhase3B,
  fingerprints as fingerprints3b,
  verifyRetained as verifyRetained3b,
} from "../scripts/phase3b-production-release-core.js";
import { inspectReadOnly as inspectReadOnly3b } from "../scripts/phase3b-release-inspection.js";
import { addWeeklyFixture } from "./phase3b-release-fixture.js";
const host = process.env.PG_TEST_HOST ?? "127.0.0.1";
assert.ok(
  ["127.0.0.1", "::1", "localhost"].includes(host),
  "Native tests require a loopback PostgreSQL server",
);
const connection = {
  host,
  port: Number(process.env.PG_TEST_PORT ?? 55432),
  user: process.env.PG_TEST_USER ?? "quemat_test",
  password: process.env.PG_TEST_PASSWORD,
  connectionTimeoutMillis: 5000,
};
const name = "quemat_test_" + randomUUID().replaceAll("-", "");
const admin = new Client({ ...connection, database: "postgres" });
await admin.connect();
await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
const pool = new Pool({ ...connection, database: name, max: 4 });
const disconnected: Promise<void>[] = [];
pool.on("connect", (client) => {
  disconnected.push(
    new Promise<void>((resolve) => client.once("end", resolve)),
  );
});
const sql = (c: Pool | import("pg").PoolClient): SQL => ({
  query: async (q, v) => (await c.query(q, v)).rows,
  exec: async (q) => {
    await c.query(q);
  },
});
const db: DB = {
  ...sql(pool),
  transaction: async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(sql(c));
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
  write: async (fn) =>
    db.transaction(async (tx) => {
      await tx.query("SELECT id FROM write_lock WHERE id=1 FOR UPDATE");
      return fn(tx);
    }),
  close: () => pool.end(),
};
let count = 0;
try {
  // Exercise the release guard on a populated Phase 2 database, never a hosted DB.
  await db.exec(
    "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
  );
  for (const migration of ["001_foundation.sql", "002_scheduling.sql"]) {
    await db.exec(readFileSync("server/migrations/" + migration, "utf8"));
    await db.query(
      "INSERT INTO schema_migrations VALUES($1,'synthetic-native-baseline')",
      [migration],
    );
  }
  await seed(db);
  const user = randomUUID(),
    instrument = (
      await db.query<{ id: string }>(
        "SELECT id FROM instruments WHERE seed_key='initial-0'",
      )
    )[0].id;
  await db.query(
    "INSERT INTO users(id,email,password_hash,full_name,status,onboarded,created_at,app_role) VALUES ($1,'native@example.test','unused','Native test','approved',1,now(),'administrator')",
    [user],
  );
  const preservedBooking = randomUUID(),
    preservedSample = randomUUID();
  await db.query(
    "INSERT INTO samples(id,owner_id,compound,origin) VALUES($1,$2,'Synthetic native preserved sample','internal')",
    [preservedSample, user],
  );
  await db.query(
    "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,actual_start,actual_end,completion_summary) VALUES($1,$2,$3,$3,'booking','completed','2026-10-20T10:00Z','2026-10-20T11:00Z','Synthetic preserved usage','2026-10-20T10:05Z','2026-10-20T10:55Z','Preserve actual outcome')",
    [preservedBooking, instrument, user],
  );
  await db.query("INSERT INTO booking_samples VALUES($1,$2)", [
    preservedBooking,
    preservedSample,
  ]);
  await db.query(
    "INSERT INTO notifications(id,user_id,booking_id,event_key,message) VALUES($1,$2,$3,'synthetic-native','Preserve this notification')",
    [randomUUID(), user, preservedBooking],
  );
  const before = await fingerprints(db);
  assert.equal(
    (await inspectReadOnly(db)).structure,
    "PHASE2_STRUCTURE_NO_003_OBJECTS",
  );
  const guarded = await applyReviewedPhase3A(
    db,
    readFileSync("server/migrations/003_weekly_progress.sql", "utf8"),
  );
  assert.deepEqual(guarded.before, before);
  assert.deepEqual(guarded.after, before);
  assert.equal(
    (
      await applyReviewedPhase3A(
        db,
        readFileSync("server/migrations/003_weekly_progress.sql", "utf8"),
      )
    ).alreadyApplied,
    true,
  );
  await verifyRetained(db, before);
  count++;
  const inspected = await inspectReadOnly(db);
  assert.equal(inspected.structure, "PHASE3A_STRUCTURE_PRESENT");
  assert.equal(inspected.rollbackProven, false);
  assert.equal(inspected.migrationAllowed, false);
  assert.equal(inspected.state.counts.bookingsWithActualStart, 1);
  assert.deepEqual(await fingerprints(db), before);
  count++;
  await addWeeklyFixture(db, user, instrument);
  const baselineUserCount = (await db.query("SELECT id FROM users")).length;
  const readOnly3b = await inspectReadOnly3b(db);
  assert.equal(readOnly3b.structure, "PHASE3A_STRUCTURE_NO_004_OBJECTS");
  assert.equal(readOnly3b.state.counts.weeklyRevisions, 2);
  count++;
  const preservationTables = [
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
        preservationTables.map(async (table) => [
          table,
          (await db.query(`SELECT * FROM ${table}`)).map((row) => {
            const value = { ...row };
            if (value.issue_id === null) delete value.issue_id;
            return value;
          }),
        ]),
      ),
    );
  const beforeIssues = await snapshot();
  const original3b = await fingerprints3b(db);
  const release3b = await applyReviewedPhase3B(
    db,
    readFileSync("server/migrations/004_issues_requests.sql", "utf8"),
  );
  assert.deepEqual(release3b.before, original3b);
  assert.deepEqual(release3b.after, original3b);
  assert.equal(
    (
      await applyReviewedPhase3B(
        db,
        readFileSync("server/migrations/004_issues_requests.sql", "utf8"),
      )
    ).alreadyApplied,
    true,
  );
  await verifyRetained3b(db, original3b);
  assert.equal(
    (await inspectReadOnly3b(db)).structure,
    "PHASE3B_STRUCTURE_PRESENT",
  );
  count++;
  await migrate(db);
  assert.deepEqual(await snapshot(), beforeIssues);
  assert.equal(
    (
      await db.query(
        "SELECT name FROM schema_migrations WHERE name='004_issues_requests.sql'",
      )
    ).length,
    1,
  );
  count++;
  const testPassword = "Synthetic-native-issues-only!";
  const passwordHash = await hashPassword(testPassword);
  await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
    passwordHash,
    user,
  ]);
  const reporter = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,password_hash,full_name,status,onboarded,academic_role,created_at) VALUES($1,'native-issues-member@example.test',$2,'Synthetic native reporter','approved',1,'Supervisor',now())",
    [reporter, passwordHash],
  );
  const origin = "http://localhost:5173",
    app = createApp(db, { origin, authLimit: 1000 });
  async function client(email: string) {
    const agent = request.agent(app);
    let csrf = (await agent.get("/api/session")).body.csrfToken;
    const write = async (path: string, data: object) => {
      const r = await agent
        .post("/api" + path)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data);
      if (r.body.csrfToken) csrf = r.body.csrfToken;
      return r;
    };
    assert.equal(
      (await write("/auth/login", { email, password: testPassword })).status,
      200,
    );
    return { agent, write };
  }
  const nativeReporter = await client("native-issues-member@example.test"),
    nativeAssignee = await client("native@example.test");
  const issue = await nativeReporter.write("/issues", {
    title: "Native synthetic issue",
    description: "Isolated native lifecycle check",
    category: "general_decision",
    assigneeId: user,
    supervisorAttention: true,
    instrumentId: instrument,
    sampleId: preservedSample,
  });
  assert.equal(issue.status, 201);
  assert.equal(issue.body.acknowledgedBy, null);
  const forbidden = await nativeReporter.write(
    `/issues/${issue.body.id}/status`,
    {
      version: 1,
      status: "acknowledged",
      reason: "Academic role must not grant permission",
    },
  );
  assert.equal(forbidden.status, 403);
  const attempts = await Promise.all(
    [1, 2].map((n) =>
      nativeAssignee.write(`/issues/${issue.body.id}/status`, {
        version: 1,
        status: "acknowledged",
        reason: `Native concurrent acknowledgement ${n}`,
      }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await db.query("SELECT id FROM issue_events WHERE issue_id=$1", [
        issue.body.id,
      ])
    ).length,
    2,
  );
  count++;
  const discussion = await nativeReporter.write(
    `/issues/${issue.body.id}/comments`,
    { body: "Native retained discussion" },
  );
  assert.equal(discussion.status, 201);
  await assert.rejects(
    db.query("DELETE FROM issue_comments WHERE issue_id=$1", [issue.body.id]),
    /append only/,
  );
  await assert.rejects(
    db.query("DELETE FROM issue_events WHERE issue_id=$1", [issue.body.id]),
    /append only/,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO notifications(id,user_id,booking_id,issue_id,event_key,message) VALUES($1,$2,$3,$4,'mixed-native','Must fail')",
      [randomUUID(), user, preservedBooking, issue.body.id],
    ),
    /notification_source/,
  );
  assert.equal(
    (
      await db.query("SELECT id FROM notifications WHERE issue_id=$1", [
        issue.body.id,
      ])
    ).length,
    3,
  );
  const restored = (
    await nativeReporter.agent.get(`/api/issues/${issue.body.id}`)
  ).body;
  assert.equal(restored.comments[0].body, "Native retained discussion");
  assert.equal(restored.acknowledgedBy, user);
  count++;
  assert.equal(
    (await db.query("SELECT id FROM users")).length,
    baselineUserCount + 1,
  );
  count++;
  const a = await pool.connect(),
    b = await pool.connect();
  try {
    const insert = `INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type) VALUES ($1,$2,$3,$3,'booking','confirmed',$4,$5,'Native concurrency test')`;
    const row = (id: string, start: string, end: string) => [
      id,
      instrument,
      user,
      start,
      end,
    ];
    // Hold an uncommitted reservation while a separate backend attempts the same slot.
    const first = randomUUID();
    await a.query("BEGIN");
    await a.query(insert, row(first, "2030-01-01T10:00Z", "2030-01-01T11:00Z"));
    const pending = b
      .query(
        insert,
        row(randomUUID(), "2030-01-01T10:00Z", "2030-01-01T11:00Z"),
      )
      .then(
        () => ({ code: "unexpected success" }),
        (e) => e,
      );
    await a.query("COMMIT");
    assert.equal((await pending).code, "23P01");
    count++;
    await b.query(
      insert,
      row(randomUUID(), "2030-01-01T11:00Z", "2030-01-01T12:00Z"),
    );
    count++;
    await db.query(
      "UPDATE instruments SET setup_minutes=10,cleanup_minutes=15 WHERE id=$1",
      [instrument],
    );
    await a.query(
      insert,
      row(randomUUID(), "2030-01-02T10:00Z", "2030-01-02T11:00Z"),
    );
    await assert.rejects(
      b.query(
        insert,
        row(randomUUID(), "2030-01-02T11:00Z", "2030-01-02T12:00Z"),
      ),
      { code: "23P01" },
    );
    count++;
    await b.query(
      insert,
      row(randomUUID(), "2030-01-02T11:25Z", "2030-01-02T12:00Z"),
    );
    count++;
    await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [
      first,
    ]);
    await b.query(
      insert,
      row(randomUUID(), "2030-01-01T10:10Z", "2030-01-01T10:40Z"),
    );
    count++;
    const ids = [randomUUID(), randomUUID()];
    await a.query(
      insert,
      row(ids[0], "2030-01-03T10:00Z", "2030-01-03T11:00Z"),
    );
    await b.query(
      insert,
      row(ids[1], "2030-01-03T12:00Z", "2030-01-03T13:00Z"),
    );
    const results = await Promise.allSettled([
      a.query(
        "UPDATE bookings SET starts_at='2030-01-04T10:00Z',ends_at='2030-01-04T11:00Z' WHERE id=$1",
        [ids[0]],
      ),
      b.query(
        "UPDATE bookings SET starts_at='2030-01-04T10:00Z',ends_at='2030-01-04T11:00Z' WHERE id=$1",
        [ids[1]],
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    // Concurrent GiST checks may reject the loser through deadlock detection
    // rather than an exclusion violation. Both abort that transaction; verify
    // the committed invariant as well as the specific allowed SQLSTATEs.
    assert.ok(
      ["23P01", "40P01"].includes(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason.code,
      ),
    );
    assert.equal(
      (
        await db.query(
          "SELECT id FROM bookings WHERE starts_at='2030-01-04T10:00Z'",
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await db.query(`SELECT a.id FROM bookings a JOIN bookings b
        ON a.id<b.id AND a.instrument_id=b.instrument_id
        AND tstzrange(a.reserved_start,a.reserved_end,'[)') && tstzrange(b.reserved_start,b.reserved_end,'[)')
        WHERE a.status<>'cancelled' AND b.status<>'cancelled'`)
      ).length,
      0,
    );
    count++;
    const actual = await Promise.allSettled(
      ids.map((id, i) =>
        (i ? a : b).query(
          "UPDATE bookings SET status='in_progress',actual_start=now() WHERE id=$1",
          [id],
        ),
      ),
    );
    assert.equal(actual.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (actual.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.code,
      "23505",
    );
    count++;
  } finally {
    a.release();
    b.release();
  }
  console.log(
    `${count} native PostgreSQL checks passed: read-only release diagnostics, guarded Phase 3A/3B preservation/idempotency including populated weekly history, additive migrations, independent-connection conflicts, adjacency, buffers, cancellation, concurrent rescheduling, exclusive actual usage.`,
  );
} finally {
  await pool.end();
  // Pool.end removes clients before their sockets necessarily finish closing.
  // Wait for every backend disconnect before dropping the isolated database;
  // FORCE can otherwise kill a closing client and emit an unhandled pool error.
  await Promise.all(disconnected);
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
}
