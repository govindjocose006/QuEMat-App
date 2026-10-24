// Phase 3B authorization is independent of the earlier 002/003 release tools.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import type { DB, SQL } from "../server/db.js";
import type { ReleaseDiagnostics } from "./phase3b-release-diagnostics.js";
import {
  production,
  ReleaseError,
  fileHash,
  checkScheduling,
} from "./production-release-core.js";
export {
  production,
  ReleaseError,
  fileHash,
  checkScheduling,
  encryptArchive,
  decryptArchive,
} from "./production-release-core.js";

import { checkWeekly } from "./phase3a-production-release-core.js";
import { inspectDatabase } from "./phase3b-release-inspection.js";

export const migrationName = "004_issues_requests.sql";
export const migrationHash =
  "2093f0203026ff677fd89366dba244e6ef7880141d7f45f441b15e2711ed44bc";
export const backupPurpose = "quemat-phase3b-production-backup-v1";
export const maxBackupAge = 24 * 60 * 60 * 1000;
const approvedMigrations = [
  "001_foundation.sql",
  "002_scheduling.sql",
  "003_weekly_progress.sql",
  migrationName,
];
export function reviewedMigration(sql: string) {
  const normalized = sql.replaceAll("\r\n", "\n");
  if (createHash("sha256").update(normalized).digest("hex") !== migrationHash)
    throw new ReleaseError(
      "Migration differs from reviewed PR #4 migration 004. No SQL was executed.",
    );
  return normalized;
}
export function productionConfig(file: string) {
  const env = parseEnv(readFileSync(file, "utf8"));
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL_UNPOOLED ?? "");
  } catch {
    throw new ReleaseError(
      "Invalid explicit Phase 3B production configuration.",
    );
  }
  if (
    env.RELEASE_PURPOSE !== "quemat-phase3b-production" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== production.host ||
    url.pathname !== "/" + production.database ||
    decodeURIComponent(url.username) !== production.role ||
    !url.password ||
    (url.port && url.port !== "5432") ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (k) => !["sslmode", "channel_binding"].includes(k),
    )
  )
    throw new ReleaseError(
      "Refusing target: Phase 3B requires its own explicit purpose, verified direct production endpoint, neondb and neondb_owner.",
    );
  // pg-connection-string returns an empty port for URLs without :5432; pg then
  // falls back to ambient PGPORT. Pin the validated default in the URL itself
  // (a separate ClientConfig.port would be overwritten by the parsed URL).
  url.port = "5432";
  return { url: url.toString(), pgBin: env.POSTGRES_BIN };
}
export async function phase3aHistory(tx: SQL) {
  const names = (
    await tx.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    )
  ).map((r) => r.name);
  if (
    approvedMigrations.slice(0, 3).some((n) => !names.includes(n)) ||
    names.some((n) => !approvedMigrations.includes(n))
  )
    throw new ReleaseError(
      "Unexpected schema history: Migrations 001/002/003 must exist; only reviewed migration 004 is permitted.",
    );
  return names;
}
// Complete row content, including authentication, actual usage and audit fields.
// Notifications alone acquire one expected NULL column; omit only that NULL.
export const preservedTables = {
  users: ["id"],
  instruments: ["id"],
  training_entries: ["id"],
  sop_links: ["id"],
  audit_events: ["id"],
  write_lock: ["id"],
  samples: ["id"],
  bookings: ["id"],
  booking_samples: ["booking_id", "sample_id"],
  availability_windows: ["id"],
  notifications: ["id"],
  sessions: ["token_hash"],
  rate_limits: ["key"],
  schema_migrations: ["name"],
  weekly_reports: ["id"],
  weekly_revisions: ["report_id", "revision"],
  weekly_comments: ["id"],
  weekly_reviews: ["report_id", "revision", "reviewer_id"],
  weekly_action_events: ["id"],
} as const;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export type Snapshot = Record<
  string,
  {
    count: number;
    sha256: string;
    rows: Record<string, string>;
    immutableRows: Record<string, string>;
    firstSubmissions: Record<string, string>;
  }
>;
export async function fingerprints(tx: SQL): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const [table, keys] of Object.entries(preservedTables)) {
    const entries = await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${table}${table === "schema_migrations" ? " WHERE name<>'004_issues_requests.sql'" : ""} ORDER BY ${keys.join(",")}`,
    );
    const rows: Record<string, string> = {},
      immutableRows: Record<string, string> = {},
      firstSubmissions: Record<string, string> = {};
    for (const row of entries) {
      if (table === "notifications" && row.issue_id === null)
        delete row.issue_id;
      const key = JSON.stringify(canonical(keys.map((k) => row[k])));
      rows[key] = hash(row);
      if (
        [
          "audit_events",
          "schema_migrations",
          "weekly_revisions",
          "weekly_reviews",
          "weekly_action_events",
        ].includes(table)
      )
        immutableRows[key] = hash(row);
      if (table === "notifications") {
        const { read_at: _read, ...content } = row;
        immutableRows[key] = hash(content);
      }
      if (table === "weekly_comments") {
        const { state: _state, version: _version, ...content } = row;
        immutableRows[key] = hash(content);
      }
      if (table === "weekly_reports") {
        immutableRows[key] = hash([row.id, row.owner_id, row.week_start]);
        if (row.first_submitted_at !== null)
          firstSubmissions[key] = String(canonical(row.first_submitted_at));
      }
    }
    result[table] = {
      count: entries.length,
      sha256: hash(rows),
      rows,
      immutableRows,
      firstSubmissions,
    };
  }
  return result;
}
export function assertPreserved(before: Snapshot, after: Snapshot) {
  for (const table of Object.keys(preservedTables))
    if (
      !before[table] ||
      !after[table] ||
      before[table].sha256 !== after[table].sha256 ||
      before[table].count !== after[table].count
    )
      throw new ReleaseError(
        "Existing records changed during migration (" +
          table +
          "). The transaction was rolled back.",
      );
}
export async function verifyRetained(tx: SQL, original: Snapshot) {
  // Later legitimate app activity may add rows or update bookings/sessions. Full
  // equality is checked atomically during migration; later checks retain stable
  // domain IDs, immutable audit/ledger rows, and report volatile auth separately.
  const current = await fingerprints(tx);
  for (const table of Object.keys(preservedTables)) {
    if (
      !original[table] ||
      !original[table].rows ||
      !original[table].immutableRows ||
      !original[table].firstSubmissions
    )
      throw new ReleaseError(
        "Incomplete preservation receipt. Release is blocked.",
      );
    if (["sessions", "rate_limits"].includes(table)) continue;
    for (const [key, sha] of Object.entries(original[table].rows)) {
      if (!(key in current[table].rows))
        throw new ReleaseError(
          "An original " + table + " record is missing. Release is blocked.",
        );
      if (
        original[table].immutableRows?.[key] &&
        current[table].immutableRows[key] !== original[table].immutableRows[key]
      )
        throw new ReleaseError(
          "Original immutable history changed. Release is blocked.",
        );
      if (
        original[table].firstSubmissions?.[key] &&
        current[table].firstSubmissions[key] !==
          original[table].firstSubmissions[key]
      )
        throw new ReleaseError(
          "An original weekly submission timestamp changed. Release is blocked.",
        );
    }
  }
  return current;
}
export async function checkIssues(tx: SQL) {
  await checkWeekly(tx);
  const inspected = await inspectDatabase(tx);
  if (inspected.structure !== "PHASE3B_STRUCTURE_PRESENT")
    throw new ReleaseError(
      "Phase 3B schema/notification/history safeguards are incomplete. Release is blocked.",
    );
}
export async function applyReviewedPhase3B(
  db: DB,
  sql: string,
  diagnostics?: ReleaseDiagnostics,
  backupGuard?: () => Promise<void>,
) {
  diagnostics?.stage("migration.hash");
  const reviewed = reviewedMigration(sql);
  diagnostics?.stage("migration.begin_or_write_lock");
  const result = await db.write(async (tx) => {
    try {
      diagnostics?.stage("migration.lock_timeout");
      await tx.exec("SET LOCAL lock_timeout='10s'");
      await tx.exec("SET LOCAL search_path=public");
      diagnostics?.stage("migration.lock_tables");
      // Freeze even auth/session writes, which do not acquire the app write lock.
      await tx.exec(
        "LOCK TABLE " +
          Object.keys(preservedTables).join(",") +
          " IN SHARE ROW EXCLUSIVE MODE",
      );
      diagnostics?.stage("migration.baseline");
      const names = await phase3aHistory(tx);
      await checkWeekly(tx);
      const inspected = await inspectDatabase(tx);
      if (
        !names.includes(migrationName) &&
        inspected.structure !== "PHASE3A_STRUCTURE_NO_004_OBJECTS"
      )
        throw new ReleaseError(
          "Partial or unexpected Phase 3B structure. Stop for read-only diagnosis; no repair/retry is automatic.",
        );
      const seeds = await tx.query(
        "SELECT seed_key FROM instruments WHERE seed_key=ANY($1::text[])",
        [Array.from({ length: 15 }, (_, i) => `initial-${i}`)],
      );
      if (
        seeds.length !== 15 ||
        !(
          await tx.query(
            "SELECT id FROM users WHERE app_role='administrator' AND status='approved' AND onboarded=1",
          )
        ).length
      )
        throw new ReleaseError(
          "Expected production instruments or active administrator are missing. No migration was applied.",
        );
      diagnostics?.stage("migration.fingerprint.before");
      const before = await fingerprints(tx);
      const sequenceBefore = await tx.query(
        "SELECT last_value,is_called FROM sample_number",
      );
      if (!names.includes(migrationName)) {
        await backupGuard?.();
        diagnostics?.stage("migration.ddl");
        await tx.exec(reviewed);
        diagnostics?.stage("migration.ledger");
        await tx.query(
          "INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2)",
          [migrationName, new Date().toISOString()],
        );
      }
      diagnostics?.stage("migration.schema_check");
      await checkIssues(tx);
      if (!names.includes(migrationName)) {
        const [n] = await tx.query<{ empty: boolean }>(
          "SELECT NOT EXISTS(SELECT 1 FROM issues) AND NOT EXISTS(SELECT 1 FROM issue_events) AND NOT EXISTS(SELECT 1 FROM issue_comments) AS empty",
        );
        if (!n.empty)
          throw new ReleaseError(
            "New issue tables are not empty; no fixtures are allowed in a production migration.",
          );
      }
      diagnostics?.stage("migration.fingerprint.after");
      const after = await fingerprints(tx);
      diagnostics?.stage("migration.preservation");
      assertPreserved(before, after);
      if (
        hash(sequenceBefore) !==
        hash(await tx.query("SELECT last_value,is_called FROM sample_number"))
      )
        throw new ReleaseError(
          "The sample numbering sequence changed. The transaction was rolled back.",
        );
      diagnostics?.stage("migration.commit");
      return {
        alreadyApplied: names.includes(migrationName),
        before,
        after,
        appliedAt: new Date().toISOString(),
      };
    } catch (error) {
      diagnostics?.capture(error);
      throw error;
    }
  });
  diagnostics?.stage("migration.completed");
  return result;
}
export type Receipt = {
  purpose: typeof backupPurpose;
  target: typeof production;
  migrationHash: string;
  archive: string;
  cipherSha256: string;
  plainSha256: string;
  bytes: number;
  createdAt: string;
  migration?: Awaited<ReturnType<typeof applyReviewedPhase3B>>;
};
export async function requireReceipt(
  receipt: Receipt,
  archive: string,
  fresh = true,
  now?: number,
) {
  const clock = () => now ?? Date.now();
  const created = Date.parse(receipt.createdAt);
  if (
    receipt.purpose !== backupPurpose ||
    JSON.stringify(receipt.target) !== JSON.stringify(production) ||
    receipt.migrationHash !== migrationHash ||
    !Number.isFinite(created) ||
    (fresh &&
      (created > clock() + 60000 || clock() - created >= maxBackupAge)) ||
    statSync(archive).size !== receipt.bytes ||
    (await fileHash(archive)) !== receipt.cipherSha256
  )
    throw new ReleaseError(
      "Phase 3B backup receipt/target/checksum/freshness mismatch. Migration is blocked.",
    );
  if (fresh && (created > clock() + 60000 || clock() - created >= maxBackupAge))
    throw new ReleaseError(
      "Phase 3B backup receipt/target/checksum/freshness mismatch. Migration is blocked.",
    );
}
