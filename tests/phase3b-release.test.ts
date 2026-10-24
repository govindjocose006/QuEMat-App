import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { openDatabase, poolOptions, type DB, type SQL } from "../server/db.js";
import { phase3aFixture } from "./phase3b-release-fixture.js";
import {
  production,
  productionConfig,
  migrationName,
  migrationHash,
  backupPurpose,
  maxBackupAge,
  reviewedMigration,
  phase3aHistory,
  fingerprints,
  applyReviewedPhase3B,
  checkIssues,
  verifyRetained,
  requireReceipt,
  fileHash,
  encryptArchive,
  decryptArchive,
  type Receipt,
} from "../scripts/phase3b-production-release-core.js";
import {
  inspectReadOnly,
  backupInspection,
} from "../scripts/phase3b-release-inspection.js";
import { ReleaseDiagnostics } from "../scripts/phase3b-release-diagnostics.js";
import { reviewedMigration as review003 } from "../scripts/phase3a-production-release-core.js";
const migration = readFileSync(
  "server/migrations/004_issues_requests.sql",
  "utf8",
);
const url = `postgresql://neondb_owner:synthetic-only@${production.host}/neondb?sslmode=require&channel_binding=require`;
let db: DB | undefined, directory: string | undefined;
function temp() {
  return (directory ??= mkdtempSync(join(tmpdir(), "quemat-release3b-")));
}
function config(value = url, purpose = "quemat-phase3b-production") {
  const file = join(temp(), ".env.production-release");
  writeFileSync(
    file,
    `RELEASE_PURPOSE=${purpose}\nDATABASE_URL_UNPOOLED=${value}\n`,
    { mode: 0o600 },
  );
  return { file, value: productionConfig(file) };
}
async function baseline() {
  db = await openDatabase({ localPath: ":memory:" });
  const fixture = await phase3aFixture(db);
  return { ...fixture, db };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
  db = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
it("authorizes only reviewed 004, normalizes CRLF and leaves 003 authorization unchanged", () => {
  expect(migrationName).toBe("004_issues_requests.sql");
  expect(migrationHash).toBe(
    "2093f0203026ff677fd89366dba244e6ef7880141d7f45f441b15e2711ed44bc",
  );
  expect(reviewedMigration(migration.replaceAll("\n", "\r\n"))).toBe(migration);
  expect(() => reviewedMigration(migration + "\nDELETE FROM users;")).toThrow(
    "reviewed PR #4",
  );
  expect(() =>
    reviewedMigration(
      readFileSync("server/migrations/003_weekly_progress.sql", "utf8"),
    ),
  ).toThrow();
  expect(() => review003(migration)).toThrow();
});
it("requires its own production purpose and explicit target; conflicting ambient pg settings cannot reroute the real driver", () => {
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "PGHOST",
    "PGUSER",
    "PGDATABASE",
  ])
    vi.stubEnv(name, "untrusted");
  vi.stubEnv("PGPORT", "15432");
  const { file, value } = config();
  const bytes = readFileSync(file);
  const candidate = new Client(poolOptions(value.url));
  expect(candidate.host).toBe(production.host);
  expect(candidate.port).toBe(5432);
  expect(candidate.user).toBe(production.role);
  expect(candidate.database).toBe(production.database);
  expect(candidate.ssl).toMatchObject({ rejectUnauthorized: true });
  expect(readFileSync(file)).toEqual(bytes);
  for (const purpose of [
    "quemat-phase2-production",
    "quemat-phase3a-production",
    "",
  ])
    expect(() => config(url, purpose)).toThrow("Refusing target");
  for (const bad of [
    url.replace(
      production.host,
      "ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech",
    ),
    url.replace(production.host, production.host.replace(".", "-pooler.")),
    url.replace("/neondb?", "/quemat_pr1_preview?"),
    url.replace("neondb_owner:", "preview:"),
    url.replace("/neondb?", ":15432/neondb?"),
    url + "&host=other",
    url + "&options=-csearch_path=other",
    url + "&sslrootcert=other",
  ])
    expect(() => config(bad)).toThrow("Refusing target");
});
it("rejects earlier receipts and original age >=24h; read-only inspection never refreshes or overwrites archive/receipt", async () => {
  const raw = join(temp(), "synthetic.dump"),
    archive = join(temp(), "synthetic.dump.enc"),
    receiptPath = join(temp(), "release-receipt.json"),
    recovered = join(temp(), "recovered.dump");
  writeFileSync(raw, "Synthetic isolated archive bytes; not production");
  const pass = "Private-synthetic-encryption-test-only!";
  await encryptArchive(raw, archive, pass);
  const now = Date.now(),
    receipt: Receipt = {
      purpose: backupPurpose,
      target: production,
      migrationHash,
      archive: "synthetic.dump.enc",
      cipherSha256: await fileHash(archive),
      plainSha256: await fileHash(raw),
      bytes: readFileSync(archive).length,
      createdAt: new Date(now - 60000).toISOString(),
    };
  writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const originalReceipt = readFileSync(receiptPath),
    originalArchive = readFileSync(archive);
  await requireReceipt(receipt, archive, true, now);
  await decryptArchive(archive, recovered, pass);
  expect(readFileSync(recovered)).toEqual(readFileSync(raw));
  for (const bad of [
    { ...receipt, purpose: "quemat-phase3a-production-backup-v1" },
    { ...receipt, migrationHash: "003" },
    { ...receipt, target: { ...production, database: "preview" } },
    { ...receipt, createdAt: new Date(now - maxBackupAge).toISOString() },
    { ...receipt, createdAt: new Date(now + 120000).toISOString() },
  ])
    await expect(
      requireReceipt(bad as Receipt, archive, true, now),
    ).rejects.toThrow("mismatch");
  const expired = {
    ...receipt,
    createdAt: new Date(now - maxBackupAge - 1).toISOString(),
  };
  await requireReceipt(expired, archive, false, now);
  expect(backupInspection(expired, now)).toMatchObject({
    backupFresh: false,
    migrationAllowed: false,
  });
  expect(backupInspection(receipt, now).backupCreatedAt).toBe(
    receipt.createdAt,
  );
  await expect(encryptArchive(raw, archive, pass)).rejects.toThrow();
  await expect(decryptArchive(archive, recovered, pass)).rejects.toThrow();
  expect(readFileSync(archive)).toEqual(originalArchive);
  expect(readFileSync(receiptPath)).toEqual(originalReceipt);
  writeFileSync(archive, "tampered");
  await expect(requireReceipt(receipt, archive, true, now)).rejects.toThrow(
    "mismatch",
  );
});
it("checks the populated 003 baseline read-only without needing a backup or exposing records", async () => {
  const { db } = await baseline(),
    before = await fingerprints(db),
    statements: string[] = [];
  const wrapped: DB = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            statements.push(q);
            await tx.exec(q);
          },
        }),
      ),
  };
  const inspected = await inspectReadOnly(wrapped);
  expect(statements[0]).toContain("REPEATABLE READ READ ONLY");
  expect(inspected).toMatchObject({
    structure: "PHASE3A_STRUCTURE_NO_004_OBJECTS",
    rollbackProven: false,
    migrationAllowed: false,
  });
  expect(inspected.state.counts).toMatchObject({
    weeklyReports: 1,
    weeklyRevisions: 2,
    weeklyComments: 1,
    weeklyReviews: 2,
    weeklyActions: 1,
  });
  const output = JSON.stringify(inspected);
  for (const secret of [
    "release3b@example.test",
    "Private synthetic revision draft",
    "Retain synthetic follow-up text",
    "password_hash",
    "sourceDefinition",
  ])
    expect(output).not.toContain(secret);
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("preserves every existing row, weekly history, actual furnace occupancy, notifications and sequences atomically; creates no issue fixtures", async () => {
  const { db, furnaceBooking } = await baseline(),
    before = await fingerprints(db),
    sequence = await db.query("SELECT last_value,is_called FROM sample_number");
  const backupGuard = vi.fn(async () => {});
  const result = await applyReviewedPhase3B(
    db,
    migration,
    undefined,
    backupGuard,
  );
  expect(backupGuard).toHaveBeenCalledOnce();
  expect(result.before).toEqual(before);
  expect(result.after).toEqual(before);
  expect(result.before.schema_migrations.count).toBe(3);
  expect(result.before.weekly_revisions.count).toBe(2);
  expect(result.before.weekly_reviews.count).toBe(2);
  expect(result.before.notifications.count).toBe(2);
  expect(
    (
      await db.query(
        "SELECT status,unloaded,actual_end FROM bookings WHERE id=$1",
        [furnaceBooking],
      )
    )[0],
  ).toMatchObject({ status: "in_progress", unloaded: false, actual_end: null });
  expect(
    await db.query("SELECT last_value,is_called FROM sample_number"),
  ).toEqual(sequence);
  for (const table of ["issues", "issue_events", "issue_comments"])
    expect(await db.query(`SELECT * FROM ${table}`)).toHaveLength(0);
  expect(await phase3aHistory(db)).toEqual([
    "001_foundation.sql",
    "002_scheduling.sql",
    "003_weekly_progress.sql",
    "004_issues_requests.sql",
  ]);
  await checkIssues(db);
  expect((await applyReviewedPhase3B(db, migration)).alreadyApplied).toBe(true);
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("rechecks backup authorization inside the locked transaction immediately before DDL", async () => {
  const { db } = await baseline(),
    before = await fingerprints(db),
    d = new ReleaseDiagnostics();
  await expect(
    applyReviewedPhase3B(db, migration, d, async () => {
      throw new Error("Synthetic expiry while waiting for locks");
    }),
  ).rejects.toThrow("expiry");
  expect(await fingerprints(db)).toEqual(before);
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE3A_STRUCTURE_NO_004_OBJECTS",
  );
  expect(d.failure(new Error("secondary")).stage).toBe(
    "migration.fingerprint.before",
  );
}, 20000);
it("rejects partial issue objects without inferring rollback from a missing ledger", async () => {
  const { db } = await baseline();
  await db.exec("ALTER TABLE notifications ADD COLUMN issue_id TEXT");
  expect((await inspectReadOnly(db)).structure).toBe(
    "PARTIAL_OR_UNEXPECTED_004_STATE",
  );
  const before = await fingerprints(db);
  await expect(applyReviewedPhase3B(db, migration)).rejects.toThrow("Partial");
  expect(await fingerprints(db)).toEqual(before);
  expect(
    (await db.query("SELECT to_regclass('public.issues') AS name"))[0].name,
  ).toBeNull();
}, 20000);
it("rolls DDL and the ledger back when a post-DDL preservation check fails", async () => {
  const { db } = await baseline(),
    before = await fingerprints(db),
    d = new ReleaseDiagnostics();
  const bad: DB = {
    ...db,
    write: (fn) =>
      db.write((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            await tx.exec(q);
            if (q.includes("CREATE TABLE issues"))
              await tx.exec(
                'UPDATE weekly_reports SET draft=\'{"results":"unexpected change"}\'',
              );
          },
        }),
      ),
  };
  await expect(applyReviewedPhase3B(bad, migration, d)).rejects.toThrow(
    "changed during migration",
  );
  expect(d.failure(new Error("secondary")).stage).toBe(
    "migration.preservation",
  );
  expect(await fingerprints(db)).toEqual(before);
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE3A_STRUCTURE_NO_004_OBJECTS",
  );
}, 20000);
it("does not initialize missing 003, accept unknown migrations or proceed without the administrator", async () => {
  const { db } = await baseline();
  await db.exec(
    "DELETE FROM schema_migrations WHERE name='003_weekly_progress.sql'",
  );
  await expect(applyReviewedPhase3B(db, migration)).rejects.toThrow(
    "001/002/003",
  );
  await db.exec(
    "INSERT INTO schema_migrations VALUES('003_weekly_progress.sql','synthetic'),('005_unapproved.sql','synthetic')",
  );
  await expect(applyReviewedPhase3B(db, migration)).rejects.toThrow(
    "001/002/003",
  );
  await db.exec(
    "DELETE FROM schema_migrations WHERE name='005_unapproved.sql';UPDATE users SET status='inactive' WHERE app_role='administrator'",
  );
  await expect(applyReviewedPhase3B(db, migration)).rejects.toThrow(
    "administrator",
  );
  expect(
    (await db.query("SELECT to_regclass('public.issues') AS name"))[0].name,
  ).toBeNull();
}, 20000);
it("checks enabled history triggers, named checks and the exact three-way notification source rule", async () => {
  const { db } = await baseline();
  await applyReviewedPhase3B(db, migration);
  await db.exec(
    "ALTER TABLE issue_events DISABLE TRIGGER issue_events_immutable",
  );
  await expect(checkIssues(db)).rejects.toThrow("safeguards");
  await db.exec(
    "ALTER TABLE issue_events ENABLE TRIGGER issue_events_immutable",
  );
  await db.exec(
    "CREATE OR REPLACE FUNCTION protect_issue_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;",
  );
  await expect(checkIssues(db)).rejects.toThrow("safeguards");
  const originalFunction = migration
    .match(/CREATE FUNCTION protect_issue_history\(\).*?\$\$;/s)![0]
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
  await db.exec(originalFunction);
  await db.exec(
    "ALTER TABLE notifications DROP CONSTRAINT notification_source;ALTER TABLE notifications ADD CONSTRAINT notification_source CHECK(true)",
  );
  await expect(checkIssues(db)).rejects.toThrow("safeguards");
  expect((await inspectReadOnly(db)).structure).toBe(
    "PARTIAL_OR_UNEXPECTED_004_STATE",
  );
}, 20000);
it("allows real later drafts/actions/reads while retaining immutable weekly/comment content and original timestamps", async () => {
  const { db, report, comment } = await baseline(),
    before = (await applyReviewedPhase3B(db, migration)).before;
  await db.query(
    'UPDATE weekly_reports SET draft=\'{"results":"Legitimate new draft"}\',version=version+1 WHERE id=$1',
    [report],
  );
  await db.query(
    "UPDATE weekly_comments SET state='done',version=version+1 WHERE id=$1",
    [comment],
  );
  await db.exec(
    "UPDATE notifications SET read_at=now();DELETE FROM sessions;DELETE FROM rate_limits",
  );
  await db.query(
    'INSERT INTO weekly_revisions(report_id,revision,content) VALUES($1,3,\'{"results":"Legitimate later submission"}\')',
    [report],
  );
  await db.query("UPDATE weekly_reports SET latest_revision=3 WHERE id=$1", [
    report,
  ]);
  await verifyRetained(db, before);
  await db.exec(
    "UPDATE notifications SET message='Unexpected message change' WHERE event_key='release3b-weekly'",
  );
  await expect(verifyRetained(db, before)).rejects.toThrow("immutable history");
  await db.exec(
    "UPDATE notifications SET message='Retain weekly notification' WHERE event_key='release3b-weekly'",
  );
  await db.query(
    "UPDATE weekly_reports SET first_submitted_at='2026-10-24T11:00Z' WHERE id=$1",
    [report],
  );
  await expect(verifyRetained(db, before)).rejects.toThrow(
    "submission timestamp",
  );
  await db.query(
    "UPDATE weekly_reports SET first_submitted_at='2026-10-23T15:00Z' WHERE id=$1",
    [report],
  );
  await db.exec(
    "ALTER TABLE weekly_comments DISABLE TRIGGER weekly_comments_immutable",
  );
  await db.query(
    "UPDATE weekly_comments SET body='Illegitimate history change' WHERE id=$1",
    [comment],
  );
  await expect(verifyRetained(db, before)).rejects.toThrow("immutable history");
}, 20000);
it("fails verification if original reports are missing or the preservation receipt is incomplete", async () => {
  const { db } = await baseline(),
    before = (await applyReviewedPhase3B(db, migration)).before;
  const bad = { ...before };
  delete bad.weekly_reviews;
  await expect(verifyRetained(db, bad)).rejects.toThrow("Incomplete");
  await db.exec(
    "ALTER TABLE weekly_reviews DISABLE TRIGGER weekly_reviews_immutable;DELETE FROM weekly_reviews",
  );
  await expect(verifyRetained(db, before)).rejects.toThrow("record is missing");
}, 20000);
it("reports sanitized Phase 3B stages/SQLSTATE without raw error details, and never claims rollback", () => {
  const secret = "postgresql://owner:PRIVATE_PASSWORD@host/db";
  const error = Object.assign(new Error(secret), {
    code: "23505",
    detail: secret,
    query: secret,
    cause: Object.assign(new Error(secret), { code: "ETIMEDOUT" }),
  });
  const d = new ReleaseDiagnostics();
  d.stage("migration.ddl");
  d.capture(error);
  const output = d.failure(
    Object.assign(new Error(secret), { code: "ECONNRESET" }),
  );
  expect(output).toMatchObject({
    error:
      "Phase 3B production release step failed; merge/deployment remain blocked",
    stage: "migration.ddl",
    code: "23505",
    rollbackProven: false,
    credentialsPrinted: false,
    secondaryError: { code: "ECONNRESET" },
  });
  expect(JSON.stringify(output)).not.toContain("PRIVATE_PASSWORD");
});
it("blocks the real CLI offline for missing/old credentials and a missing backup, preserving private files", () => {
  const entry = resolve("scripts/phase3b-production-release.ts");
  let run = spawnSync(process.execPath, ["--import", "tsx", entry], {
    encoding: "utf8",
  });
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stderr)).toMatchObject({
    stage: "configuration",
    credentialsPrinted: false,
  });
  expect(() => config(url, "quemat-phase3a-production")).toThrow(
    "Refusing target",
  );
  const file = join(temp(), ".env.production-release");
  const original = readFileSync(file);
  run = spawnSync(
    process.execPath,
    ["--import", "tsx", entry, file, "inspect-backup"],
    { encoding: "utf8" },
  );
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stderr).stage).toBe("configuration");
  expect(readFileSync(file)).toEqual(original);
  config();
  run = spawnSync(
    process.execPath,
    ["--import", "tsx", entry, file, "inspect-backup"],
    { encoding: "utf8" },
  );
  expect(run.status).toBe(1);
  expect(JSON.parse(run.stderr)).toMatchObject({
    stage: "backup.receipt.read",
    diagnostic: { guard: "BACKUP_REQUIRED" },
  });
  expect(existsSync(join(temp(), "release-receipt.json"))).toBe(false);
});
