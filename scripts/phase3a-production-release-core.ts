// Phase 3A authorization is deliberately independent of the pinned Phase 2 tool.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import type { DB, SQL } from "../server/db.js";
import type { ReleaseDiagnostics } from "./phase3a-release-diagnostics.js";
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

export const migrationName = "003_weekly_progress.sql";
export const migrationHash =
  "d2a89110a6e746c6e34023a382dc953124886728c50e6c2c41a58f9a24cec696";
export const backupPurpose = "quemat-phase3a-production-backup-v1";
export const maxBackupAge = 24 * 60 * 60 * 1000;
const approvedMigrations = [
  "001_foundation.sql",
  "002_scheduling.sql",
  migrationName,
];
export function reviewedMigration(sql: string) {
  const normalized = sql.replaceAll("\r\n", "\n");
  if (createHash("sha256").update(normalized).digest("hex") !== migrationHash)
    throw new ReleaseError(
      "Migration differs from reviewed PR #2 migration 003. No SQL was executed.",
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
      "Invalid explicit Phase 3A production configuration.",
    );
  }
  if (
    env.RELEASE_PURPOSE !== "quemat-phase3a-production" ||
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
      "Refusing target: Phase 3A requires its own explicit purpose, verified direct production endpoint, neondb and neondb_owner.",
    );
  // pg-connection-string returns an empty port for URLs without :5432; pg then
  // falls back to ambient PGPORT. Pin the validated default in the URL itself
  // (a separate ClientConfig.port would be overwritten by the parsed URL).
  url.port = "5432";
  return { url: url.toString(), pgBin: env.POSTGRES_BIN };
}
export async function phase2History(tx: SQL) {
  const names = (
    await tx.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    )
  ).map((r) => r.name);
  if (
    !names.includes(approvedMigrations[0]) ||
    !names.includes(approvedMigrations[1]) ||
    names.some((n) => !approvedMigrations.includes(n))
  )
    throw new ReleaseError(
      "Unexpected schema history: Phase 1 and Phase 2 must exist; only reviewed migration 003 is permitted.",
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
  { count: number; sha256: string; rows: Record<string, string> }
>;
export async function fingerprints(tx: SQL): Promise<Snapshot> {
  const result: Snapshot = {};
  for (const [table, keys] of Object.entries(preservedTables)) {
    const entries = await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${table}${table === "schema_migrations" ? " WHERE name<>'003_weekly_progress.sql'" : ""} ORDER BY ${keys.join(",")}`,
    );
    const rows: Record<string, string> = {};
    for (const row of entries) {
      if (table === "notifications" && row.weekly_report_id === null)
        delete row.weekly_report_id;
      rows[JSON.stringify(canonical(keys.map((k) => row[k])))] = hash(row);
    }
    result[table] = { count: entries.length, sha256: hash(rows), rows };
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
    if (!original[table])
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
        ["audit_events", "schema_migrations"].includes(table) &&
        current[table].rows[key] !== sha
      )
        throw new ReleaseError(
          "Original immutable history changed. Release is blocked.",
        );
    }
  }
  return current;
}
export async function checkWeekly(tx: SQL) {
  await checkScheduling(tx);
  for (const table of [
    "weekly_reports",
    "weekly_revisions",
    "weekly_comments",
    "weekly_reviews",
    "weekly_action_events",
  ])
    if (
      !(
        await tx.query("SELECT to_regclass($1) AS name", ["public." + table])
      )[0]?.name
    )
      throw new ReleaseError("Phase 3A table verification failed.");
  const constraints = [
    ["weekly_reports", "weekly_reports_owner_id_week_start_key", "u"],
    ["weekly_reports", "weekly_reports_week_start_check", "c"],
    ["weekly_revisions", "weekly_revisions_pkey", "p"],
    ["weekly_comments", "weekly_comments_report_id_revision_fkey", "f"],
    ["weekly_reviews", "weekly_reviews_report_id_revision_fkey", "f"],
    ["notifications", "notifications_weekly_report_id_fkey", "f"],
    ["notifications", "notification_source", "c"],
  ];
  for (const [table, name, type] of constraints)
    if (
      !(
        await tx.query(
          "SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname=$2 AND contype=$3 AND convalidated",
          ["public." + table, name, type],
        )
      ).length
    )
      throw new ReleaseError(
        "Phase 3A constraint verification failed: " + name,
      );
  for (const [table, name, fn] of [
    [
      "weekly_revisions",
      "weekly_revisions_immutable",
      "protect_weekly_history()",
    ],
    ["weekly_reviews", "weekly_reviews_immutable", "protect_weekly_history()"],
    [
      "weekly_action_events",
      "weekly_actions_immutable",
      "protect_weekly_history()",
    ],
    [
      "weekly_comments",
      "weekly_comments_immutable",
      "protect_weekly_comment()",
    ],
  ])
    if (
      !(
        await tx.query(
          "SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgfoid=to_regprocedure($3) AND tgenabled IN ('O','A') AND NOT tgisinternal",
          ["public." + table, name, fn],
        )
      ).length
    )
      throw new ReleaseError(
        "Phase 3A immutable-history trigger verification failed.",
      );
  const column = await tx.query<{ is_nullable: string }>(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='booking_id'",
  );
  if (column[0]?.is_nullable !== "YES")
    throw new ReleaseError(
      "Weekly notification compatibility verification failed.",
    );
}
export async function applyReviewedPhase3A(
  db: DB,
  sql: string,
  diagnostics?: ReleaseDiagnostics,
) {
  diagnostics?.stage("migration.hash");
  const reviewed = reviewedMigration(sql);
  diagnostics?.stage("migration.begin_or_write_lock");
  const result = await db.write(async (tx) => {
    try {
      diagnostics?.stage("migration.lock_timeout");
      await tx.exec("SET LOCAL lock_timeout='10s'");
      diagnostics?.stage("migration.lock_tables");
      // Freeze even auth/session writes, which do not acquire the app write lock.
      await tx.exec(
        "LOCK TABLE " +
          Object.keys(preservedTables).join(",") +
          " IN SHARE ROW EXCLUSIVE MODE",
      );
      diagnostics?.stage("migration.baseline");
      const names = await phase2History(tx);
      await checkScheduling(tx);
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
        diagnostics?.stage("migration.ddl");
        await tx.exec(reviewed);
        diagnostics?.stage("migration.ledger");
        await tx.query(
          "INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2)",
          [migrationName, new Date().toISOString()],
        );
      }
      diagnostics?.stage("migration.schema_check");
      await checkWeekly(tx);
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
  migration?: Awaited<ReturnType<typeof applyReviewedPhase3A>>;
};
export async function requireReceipt(
  receipt: Receipt,
  archive: string,
  fresh = true,
  now = Date.now(),
) {
  const created = Date.parse(receipt.createdAt);
  if (
    receipt.purpose !== backupPurpose ||
    JSON.stringify(receipt.target) !== JSON.stringify(production) ||
    receipt.migrationHash !== migrationHash ||
    !Number.isFinite(created) ||
    (fresh && (created > now + 60000 || now - created > maxBackupAge)) ||
    statSync(archive).size !== receipt.bytes ||
    (await fileHash(archive)) !== receipt.cipherSha256
  )
    throw new ReleaseError(
      "Phase 3A backup receipt/target/checksum/freshness mismatch. Migration is blocked.",
    );
}
