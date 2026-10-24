import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { openDatabase, seed, type DB } from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import {
  production,
  productionConfig,
  migrationName,
  migrationHash,
  backupPurpose,
  maxBackupAge,
  reviewedMigration,
  phase2History,
  fingerprints,
  applyReviewedPhase3A,
  checkWeekly,
  requireReceipt,
  fileHash,
  verifyRetained,
  type Receipt,
} from "../scripts/phase3a-production-release-core.js";
let directory: string | undefined, db: DB | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
  db = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
const migration = readFileSync(
  "server/migrations/003_weekly_progress.sql",
  "utf8",
);
const url = `postgresql://neondb_owner:synthetic-only@${production.host}/neondb?sslmode=require&channel_binding=require`;
function temporary() {
  return (directory ??= mkdtempSync(join(tmpdir(), "quemat-phase3a-release-")));
}
function config(value = url, purpose = "quemat-phase3a-production") {
  const file = join(temporary(), ".env.production-release");
  writeFileSync(
    file,
    `RELEASE_PURPOSE=${purpose}\nDATABASE_URL_UNPOOLED=${value}\n`,
    { mode: 0o600 },
  );
  return { file, value: productionConfig(file) };
}
async function phase2() {
  db = await openDatabase({ localPath: ":memory:" });
  await db.exec(
    "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
  );
  for (const name of ["001_foundation.sql", "002_scheduling.sql"]) {
    await db.exec(readFileSync("server/migrations/" + name, "utf8"));
    await db.query(
      "INSERT INTO schema_migrations VALUES($1,'synthetic-legacy-time')",
      [name],
    );
  }
  await seed(db);
  const owner = await bootstrapAdmin(
    db,
    "release3a@example.test",
    "Synthetic-release-tests-only!",
    "Synthetic Phase 3A release admin",
  );
  const instrument = (
    await db.query<{ id: string }>(
      "SELECT id FROM instruments WHERE name='PPMS'",
    )
  )[0].id;
  const sample = randomUUID(),
    future = randomUUID(),
    past = randomUUID();
  await db.query(
    "INSERT INTO samples(id,owner_id,compound,origin,notes) VALUES($1,$2,'Synthetic preserved FeSe','internal','Preserve sample notes')",
    [sample, owner],
  );
  const insert =
    "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,actual_start,actual_end,completion_summary,handover_notes) VALUES($1,$2,$3,$3,'booking',$4,$5,$6,'Synthetic release regression',$7,$8,$9,'Preserve handover')";
  await db.query(insert, [
    future,
    instrument,
    owner,
    "confirmed",
    "2030-01-01T10:00Z",
    "2030-01-01T11:00Z",
    null,
    null,
    "",
  ]);
  await db.query(insert, [
    past,
    instrument,
    owner,
    "completed",
    "2026-10-20T10:00Z",
    "2026-10-20T11:00Z",
    "2026-10-20T10:05Z",
    "2026-10-20T10:55Z",
    "Preserve actual measurements",
  ]);
  await db.query("INSERT INTO booking_samples VALUES($1,$2)", [past, sample]);
  await db.query(
    "INSERT INTO notifications(id,user_id,booking_id,event_key,message,read_at) VALUES($1,$2,$3,'synthetic-existing','Preserve booking notification','2026-10-20T12:00Z')",
    [randomUUID(), owner, past],
  );
  await db.query(
    "INSERT INTO availability_windows(id,instrument_id,starts_at,ends_at,reference,created_by) VALUES($1,$2,'2030-02-01T00:00Z','2030-02-02T00:00Z','Preserve allocation',$3)",
    [randomUUID(), instrument, owner],
  );
  await db.query(
    "INSERT INTO sessions VALUES('synthetic-session-hash',$1,'synthetic-csrf',123456789)",
    [owner],
  );
  await db.query(
    "INSERT INTO rate_limits VALUES('synthetic-client',2,123456789)",
  );
  return { db, owner, sample, future, past, instrument };
}
it("pins only the reviewed 003 SQL, including Windows CRLF, and leaves 002 authorization separate", () => {
  expect(migrationName).toBe("003_weekly_progress.sql");
  expect(reviewedMigration(migration.replaceAll("\n", "\r\n"))).toBe(migration);
  expect(() => reviewedMigration(migration + "\nDROP TABLE samples;")).toThrow(
    "differs from reviewed PR #2",
  );
  expect(() =>
    reviewedMigration(
      readFileSync("server/migrations/002_scheduling.sql", "utf8"),
    ),
  ).toThrow();
});
it("ignores ambient credentials and rejects Phase 2 purpose, preview, pooler and connection overrides", () => {
  vi.stubEnv("DATABASE_URL_UNPOOLED", "untrusted");
  vi.stubEnv("DATABASE_URL", "untrusted");
  expect(config().value.url).toBe(url);
  for (const bad of [
    url.replace(
      production.host,
      "ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech",
    ),
    url.replace(production.host, production.host.replace(".", "-pooler.")),
    url.replace("/neondb?", "/quemat_pr1_preview?"),
    url.replace("neondb_owner:", "preview:"),
    url + "&host=elsewhere",
    url + "&sslrootcert=elsewhere",
  ])
    expect(() => config(bad)).toThrow("Refusing target");
  expect(() => config(url, "quemat-phase2-production")).toThrow(
    "Refusing target",
  );
});
it("requires a fresh Phase 3A-specific, target/hash-bound encrypted backup receipt", async () => {
  const archive = join(temporary(), "synthetic.dump.enc");
  writeFileSync(archive, "Synthetic cipher bytes");
  const receipt: Receipt = {
    purpose: backupPurpose,
    target: production,
    migrationHash,
    archive: "synthetic.dump.enc",
    cipherSha256: await fileHash(archive),
    plainSha256: "synthetic",
    bytes: readFileSync(archive).length,
    createdAt: new Date().toISOString(),
  };
  await expect(requireReceipt(receipt, archive)).resolves.toBeUndefined();
  for (const bad of [
    { ...receipt, purpose: "quemat-phase2-production-backup-v1" },
    { ...receipt, migrationHash: "phase2" },
    { ...receipt, target: { ...production, database: "preview" } },
    {
      ...receipt,
      createdAt: new Date(Date.now() - maxBackupAge - 10000).toISOString(),
    },
    { ...receipt, createdAt: new Date(Date.now() + 120000).toISOString() },
  ])
    await expect(requireReceipt(bad as Receipt, archive)).rejects.toThrow(
      "mismatch",
    );
  await expect(
    requireReceipt(
      {
        ...receipt,
        createdAt: new Date(Date.now() - maxBackupAge - 10000).toISOString(),
      },
      archive,
      false,
    ),
  ).resolves.toBeUndefined();
  writeFileSync(archive, "Different cipher bytes");
  await expect(requireReceipt(receipt, archive)).rejects.toThrow("mismatch");
});
it("preserves every Phase 1/2 row, actual usage, sample links, read notifications, sessions, sequences and ledger; safe repeat", async () => {
  const { db } = await phase2();
  const before = await fingerprints(db),
    seq = await db.query("SELECT last_value,is_called FROM sample_number");
  const result = await applyReviewedPhase3A(db, migration);
  expect(result.before).toEqual(before);
  expect(result.after).toEqual(before);
  expect(result.before.bookings.count).toBe(2);
  expect(result.before.booking_samples.count).toBe(1);
  expect(result.before.notifications.count).toBe(1);
  expect(result.before.sessions.count).toBe(1);
  expect(
    await db.query("SELECT last_value,is_called FROM sample_number"),
  ).toEqual(seq);
  expect(await phase2History(db)).toEqual([
    "001_foundation.sql",
    "002_scheduling.sql",
    "003_weekly_progress.sql",
  ]);
  for (const table of [
    "weekly_reports",
    "weekly_revisions",
    "weekly_comments",
    "weekly_reviews",
    "weekly_action_events",
  ])
    expect(await db.query(`SELECT * FROM ${table}`)).toHaveLength(0);
  expect((await applyReviewedPhase3A(db, migration)).alreadyApplied).toBe(true);
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("rolls all 003 DDL back if an existing table makes migration fail", async () => {
  const { db } = await phase2();
  const before = await fingerprints(db);
  await db.exec("CREATE TABLE weekly_comments(marker TEXT)");
  await expect(applyReviewedPhase3A(db, migration)).rejects.toThrow();
  expect(await fingerprints(db)).toEqual(before);
  expect(await phase2History(db)).toHaveLength(2);
  expect(
    (await db.query("SELECT to_regclass('public.weekly_reports') AS name"))[0]
      .name,
  ).toBeNull();
}, 20000);
it("rejects unreviewed SQL and unknown or missing baseline migrations before applying 003", async () => {
  const { db } = await phase2();
  const before = await fingerprints(db);
  await expect(
    applyReviewedPhase3A(db, migration + "\nDELETE FROM samples;"),
  ).rejects.toThrow("differs from reviewed");
  expect(await fingerprints(db)).toEqual(before);
  await db.query(
    "INSERT INTO schema_migrations VALUES('004_unapproved.sql','synthetic')",
  );
  await expect(applyReviewedPhase3A(db, migration)).rejects.toThrow(
    "Unexpected schema history",
  );
  await db.query(
    "DELETE FROM schema_migrations WHERE name IN ('004_unapproved.sql','002_scheduling.sql')",
  );
  await expect(applyReviewedPhase3A(db, migration)).rejects.toThrow(
    "Unexpected schema history",
  );
  expect(
    (await db.query("SELECT to_regclass('public.weekly_reports') AS name"))[0]
      .name,
  ).toBeNull();
}, 20000);
it("refuses missing administrator/seed identities instead of repairing or seeding production", async () => {
  const { db } = await phase2();
  await db.query(
    "UPDATE instruments SET seed_key=NULL WHERE seed_key='initial-14'",
  );
  await expect(applyReviewedPhase3A(db, migration)).rejects.toThrow(
    "Expected production",
  );
  expect(await db.query("SELECT * FROM instruments")).toHaveLength(15);
}, 20000);
it("rolls back if existing Phase 2 content is changed during migration verification", async () => {
  const { db } = await phase2();
  const before = await fingerprints(db);
  const wrapped: DB = {
    ...db,
    write: (fn) =>
      db.write((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            await tx.exec(q);
            if (q.includes("CREATE TABLE weekly_reports"))
              await tx.exec(
                "UPDATE bookings SET completion_summary='Changed actual result' WHERE status='completed'",
              );
          },
        }),
      ),
  };
  await expect(applyReviewedPhase3A(wrapped, migration)).rejects.toThrow(
    "Existing records changed",
  );
  expect(await fingerprints(db)).toEqual(before);
  expect(await phase2History(db)).toHaveLength(2);
}, 20000);
it("checks immutable triggers, notification and booking constraints after migration", async () => {
  const { db } = await phase2();
  await applyReviewedPhase3A(db, migration);
  await checkWeekly(db);
  await db.exec(
    "ALTER TABLE weekly_revisions DISABLE TRIGGER weekly_revisions_immutable",
  );
  await expect(checkWeekly(db)).rejects.toThrow("immutable-history");
  await db.exec(
    "ALTER TABLE weekly_revisions ENABLE TRIGGER weekly_revisions_immutable",
  );
  await db.exec(
    "ALTER TABLE notifications DROP CONSTRAINT notification_source",
  );
  await expect(checkWeekly(db)).rejects.toThrow("notification_source");
}, 20000);
it("post-migration verification retains original IDs/history while permitting new activity and expired-session cleanup", async () => {
  const { db, future, owner } = await phase2();
  const { before } = await applyReviewedPhase3A(db, migration);
  await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [
    future,
  ]);
  await db.exec("DELETE FROM sessions;DELETE FROM rate_limits");
  await db.query(
    "INSERT INTO samples(id,owner_id,compound,origin) VALUES($1,$2,'New synthetic sample','internal')",
    [randomUUID(), owner],
  );
  await expect(verifyRetained(db, before)).resolves.toBeDefined();
  await db.exec("DELETE FROM booking_samples");
  await expect(verifyRetained(db, before)).rejects.toThrow(
    "original booking_samples",
  );
}, 20000);
function cli(action: string, releaseConfig: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/phase3a-production-release.ts",
      releaseConfig,
      action,
    ],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "never-used",
        DATABASE_URL_UNPOOLED: "never-used",
      },
      timeout: 20000,
    },
  );
}
function clientConfig() {
  const dir = temporary();
  for (const tool of ["pg_dump", "pg_restore"])
    writeFileSync(
      join(dir, tool),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo \'PostgreSQL 18.1\'; else exit 99; fi\n',
      { mode: 0o700 },
    );
  const file = join(dir, ".env.production-release");
  writeFileSync(
    file,
    `RELEASE_PURPOSE=quemat-phase3a-production\nDATABASE_URL_UNPOOLED=${url}\nPOSTGRES_BIN=${dir}\n`,
    { mode: 0o600 },
  );
  return file;
}
it.skipIf(process.platform === "win32")(
  "CLI preflight is offline and migration refuses a missing backup before accessing a database",
  () => {
    const file = clientConfig(),
      pre = cli("preflight", file);
    expect(pre.status, pre.stderr).toBe(0);
    expect(JSON.parse(pre.stdout)).toMatchObject({
      migration: migrationName,
      migrationHash,
      databaseAccessed: false,
    });
    const result = cli("migrate", file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Create and verify the encrypted production backup first",
    );
    expect(result.stdout).not.toContain("synthetic-only");
  },
  30000,
);
it.skipIf(process.platform === "win32")(
  "CLI never overwrites the previous Phase 2 archive or receipt, even with a Phase 3A config",
  () => {
    const file = clientConfig(),
      dir = temporary(),
      archive = join(dir, "previous.dump.enc"),
      receipt = join(dir, "release-receipt.json");
    writeFileSync(archive, "KEEP PREVIOUS BACKUP");
    writeFileSync(
      receipt,
      JSON.stringify({
        purpose: "quemat-phase2-production-backup-v1",
        archive: "previous.dump.enc",
      }),
    );
    const receiptBefore = readFileSync(receipt),
      result = cli("backup", file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mismatch");
    expect(readFileSync(archive, "utf8")).toBe("KEEP PREVIOUS BACKUP");
    expect(readFileSync(receipt)).toEqual(receiptBefore);
    expect(existsSync(archive)).toBe(true);
  },
  30000,
);

it("sanitizes nested errors and preserves stage/code without serializing secrets or records", async () => {
  const { ReleaseDiagnostics, safeError } =
    await import("../scripts/phase3a-release-diagnostics.js");
  const secret =
    "postgresql://private-user:PRIVATE_PASSWORD@private-host/private-record";
  const err = Object.assign(new Error(secret), {
    code: "23505",
    detail: secret,
    query: secret,
    path: secret,
    cause: Object.assign(new Error(secret), { code: "ETIMEDOUT" }),
  });
  const d = new ReleaseDiagnostics();
  d.stage("migration.ddl");
  d.capture(err);
  const secondary = Object.assign(new Error(secret), { code: "ECONNRESET" });
  const output = d.failure(secondary),
    text = JSON.stringify(output);
  expect(output).toMatchObject({
    stage: "migration.ddl",
    errorType: "DatabaseError",
    code: "23505",
    rollbackProven: false,
    secondaryError: { code: "ECONNRESET" },
  });
  expect(text).not.toContain(secret);
  expect(text).not.toContain("PRIVATE_PASSWORD");
  expect(
    safeError({
      name: secret,
      code: secret,
      message: secret,
      errors: [secret],
      cause: secret,
    }),
  ).toMatchObject({ type: "UnknownError", code: null });
  const cycle: Record<string, unknown> = { name: "Error" };
  cycle.cause = cycle;
  expect(() => JSON.stringify(safeError(cycle))).not.toThrow();
  expect(
    safeError(new Error("Connection terminated due to connection timeout")),
  ).toMatchObject({ type: "Error", code: null, kind: "connection_timeout" });
});
it("inspects Phase 2 through an explicitly read-only transaction and returns no application records", async () => {
  const { inspectReadOnly } =
    await import("../scripts/phase3a-release-inspection.js");
  const { db } = await phase2();
  const before = await fingerprints(db);
  let checked = false;
  const wrapped: DB = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          ...tx,
          query: async <T>(q: string, v?: unknown[]) => {
            if (q.includes("expected_tables")) {
              expect(
                (
                  await tx.query(
                    "SELECT current_setting('transaction_read_only') AS value",
                  )
                )[0].value,
              ).toBe("on");
              checked = true;
            }
            return tx.query<T>(q, v);
          },
        }),
      ),
  };
  const result = await inspectReadOnly(wrapped);
  expect(checked).toBe(true);
  expect(result).toMatchObject({
    structure: "PHASE2_STRUCTURE_NO_003_OBJECTS",
    rollbackProven: false,
    migrationAllowed: false,
  });
  expect(result.state.counts).toMatchObject({
    users: 1,
    instruments: 15,
    bookings: 2,
    bookingsWithActualStart: 1,
  });
  const text = JSON.stringify(result);
  expect(text).not.toContain("release3a@example.test");
  expect(text).not.toContain("Preserve actual measurements");
  expect(text).not.toContain("synthetic-session-hash");
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("detects objects or notification changes without a ledger entry and never calls that proof of rollback", async () => {
  const { inspectReadOnly } =
    await import("../scripts/phase3a-release-inspection.js");
  const { db } = await phase2();
  await db.exec("CREATE TABLE weekly_reports(marker TEXT)");
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PARTIAL_OR_UNEXPECTED_003_STATE",
    rollbackProven: false,
    migrationAllowed: false,
  });
  await db.exec(
    "DROP TABLE weekly_reports;ALTER TABLE notifications ADD COLUMN weekly_report_id TEXT",
  );
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PARTIAL_OR_UNEXPECTED_003_STATE",
    rollbackProven: false,
  });
}, 20000);
it("reports complete and damaged 003 structures independently from the migration ledger", async () => {
  const { inspectReadOnly } =
    await import("../scripts/phase3a-release-inspection.js");
  const { db } = await phase2();
  await applyReviewedPhase3A(db, migration);
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PHASE3A_STRUCTURE_PRESENT",
    rollbackProven: false,
    migrationAllowed: false,
  });
  await db.exec(
    "ALTER TABLE weekly_revisions DISABLE TRIGGER weekly_revisions_immutable",
  );
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PARTIAL_OR_UNEXPECTED_003_STATE",
    rollbackProven: false,
  });
}, 20000);
it("identifies failed DDL and retains its primary sanitized error if rollback reporting masks it", async () => {
  const { ReleaseDiagnostics } =
    await import("../scripts/phase3a-release-diagnostics.js");
  const { inspectReadOnly } =
    await import("../scripts/phase3a-release-inspection.js");
  const { db } = await phase2();
  const before = await fingerprints(db),
    d = new ReleaseDiagnostics();
  const primary = Object.assign(new Error("PRIVATE record contents"), {
      code: "XX000",
    }),
    secondary = new Error("PRIVATE rollback connection message");
  const wrapped: DB = {
    ...db,
    write: async (fn) => {
      try {
        return await db.write((tx) =>
          fn({
            ...tx,
            exec: async (q) => {
              await tx.exec(q);
              if (q.includes("CREATE TABLE weekly_reports")) throw primary;
            },
          }),
        );
      } catch {
        throw secondary;
      }
    },
  };
  let failure: unknown;
  try {
    await applyReviewedPhase3A(wrapped, migration, d);
  } catch (e) {
    failure = e;
  }
  expect(d.failure(failure)).toMatchObject({
    stage: "migration.ddl",
    code: "XX000",
    secondaryError: { type: "Error" },
    rollbackProven: false,
  });
  expect(JSON.stringify(d.failure(failure))).not.toContain("PRIVATE");
  expect(await fingerprints(db)).toEqual(before);
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PHASE2_STRUCTURE_NO_003_OBJECTS",
  });
}, 20000);
it("treats a lost commit acknowledgement as uncertain and does not infer rollback from an error", async () => {
  const { ReleaseDiagnostics } =
    await import("../scripts/phase3a-release-diagnostics.js");
  const { inspectReadOnly } =
    await import("../scripts/phase3a-release-inspection.js");
  const { db } = await phase2(),
    d = new ReleaseDiagnostics();
  const wrapped: DB = {
    ...db,
    write: async (fn) => {
      await db.write(fn);
      throw new Error("Connection terminated unexpectedly");
    },
  };
  let failure: unknown;
  try {
    await applyReviewedPhase3A(wrapped, migration, d);
  } catch (e) {
    failure = e;
  }
  expect(d.failure(failure)).toMatchObject({
    stage: "migration.commit",
    databaseOutcome: "NOT_ESTABLISHED_BY_ERROR_OUTPUT",
    rollbackProven: false,
    diagnostic: { kind: "connection_closed" },
  });
  expect(await inspectReadOnly(db)).toMatchObject({
    structure: "PHASE3A_STRUCTURE_PRESENT",
  });
  const ack = new ReleaseDiagnostics();
  ack.stage("migration.completed");
  ack.stage("backup.receipt.write");
  expect(ack.failure({ code: "EPERM" })).toMatchObject({
    stage: "backup.receipt.write",
    databaseOutcome: "MIGRATION_COMMIT_ACKNOWLEDGED",
    code: "EPERM",
  });
}, 20000);
it.skipIf(process.platform === "win32")(
  "read-only backup inspection preserves an expired archive/receipt and does not authorize a migration",
  async () => {
    const file = clientConfig(),
      dir = temporary(),
      archive = join(dir, "retained.dump.enc"),
      receiptPath = join(dir, "release-receipt.json");
    writeFileSync(archive, "RETAIN ORIGINAL ENCRYPTED BYTES");
    const receipt: Receipt = {
      purpose: backupPurpose,
      target: production,
      migrationHash,
      archive: "retained.dump.enc",
      cipherSha256: await fileHash(archive),
      plainSha256: "synthetic",
      bytes: readFileSync(archive).length,
      createdAt: new Date(Date.now() - maxBackupAge - 60000).toISOString(),
    };
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const oldArchive = readFileSync(archive),
      oldReceipt = readFileSync(receiptPath);
    const inspected = cli("inspect-backup", file);
    expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      backup: {
        backupFresh: false,
        freshnessLimitHours: 24,
        migrationAllowed: false,
        receiptHasMigrationRecord: false,
      },
    });
    const blocked = cli("migrate", file);
    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stderr)).toMatchObject({
      stage: "backup.archive.hash",
      diagnostic: { guard: "BACKUP_RECEIPT_MISMATCH_OR_EXPIRED" },
      rollbackProven: false,
    });
    expect(readFileSync(archive)).toEqual(oldArchive);
    expect(readFileSync(receiptPath)).toEqual(oldReceipt);
    expect(inspected.stdout + blocked.stderr).not.toContain("synthetic-only");
  },
  30000,
);
