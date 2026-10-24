import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DB, SQL } from "../server/db.js";
import type { ReleaseDiagnostics } from "./phase3a-release-diagnostics.js";
import {
  maxBackupAge,
  type Receipt,
} from "./phase3a-production-release-core.js";

export type DatabaseState = {
  expectedDatabase: boolean;
  expectedRole: boolean;
  postgres18: boolean;
  migrations: {
    foundation: boolean;
    scheduling: boolean;
    weekly: boolean;
    unexpectedCount: number;
  };
  weeklyTables: Record<string, boolean>;
  weeklyIndexes: Record<string, boolean>;
  weeklyFunctions: Record<string, boolean>;
  weeklyTriggers: Record<string, boolean>;
  weeklyTriggersEnabled: Record<string, boolean>;
  weeklyConstraints: Record<string, boolean>;
  weeklyConstraintsValid: Record<string, boolean>;
  notifications: { weeklyColumn: boolean; bookingColumnNotNull: boolean };
  phase2Safeguards: Record<string, boolean>;
  counts: Record<string, number>;
};
const values = (v: Record<string, boolean>) => Object.values(v);
export function classifyState(state: DatabaseState) {
  const groups = [
    state.weeklyTables,
    state.weeklyIndexes,
    state.weeklyFunctions,
    state.weeklyTriggers,
    state.weeklyConstraints,
  ];
  const anyWeekly =
    groups.some((g) => values(g).some(Boolean)) ||
    state.notifications.weeklyColumn ||
    !state.notifications.bookingColumnNotNull;
  const baseline =
    state.migrations.foundation &&
    state.migrations.scheduling &&
    state.migrations.unexpectedCount === 0 &&
    values(state.phase2Safeguards).every(Boolean);
  const complete =
    groups.every((g) => values(g).every(Boolean)) &&
    values(state.weeklyTriggersEnabled).every(Boolean) &&
    values(state.weeklyConstraintsValid).every(Boolean) &&
    state.notifications.weeklyColumn &&
    !state.notifications.bookingColumnNotNull;
  return {
    structure: !baseline
      ? "UNEXPECTED_BASELINE"
      : !state.migrations.weekly && !anyWeekly
        ? "PHASE2_STRUCTURE_NO_003_OBJECTS"
        : state.migrations.weekly && complete
          ? "PHASE3A_STRUCTURE_PRESENT"
          : "PARTIAL_OR_UNEXPECTED_003_STATE",
    rollbackProven: false,
    recordPreservation: "NOT_ESTABLISHED_BY_CATALOG_OR_COUNTS",
    migrationAllowed: false,
  };
}
export async function inspectDatabase(tx: SQL) {
  const sql = readFileSync(
    fileURLToPath(new URL("./phase3a-release-state.sql", import.meta.url)),
    "utf8",
  );
  const [row] = await tx.query<{ state: DatabaseState }>(sql);
  return { ...classifyState(row.state), state: row.state };
}
export async function inspectReadOnly(
  db: DB,
  diagnostics?: ReleaseDiagnostics,
) {
  diagnostics?.stage("database.read_only.begin");
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    diagnostics?.stage("database.read_only.catalog");
    return inspectDatabase(tx);
  });
}
export function backupInspection(receipt: Receipt, now = Date.now()) {
  const created = Date.parse(receipt.createdAt),
    age = now - created;
  return {
    diagnosticOnly: true,
    archiveChecksum: "VERIFIED",
    encryptionReadability: "NOT_RECHECKED",
    backupCreatedAt: new Date(created).toISOString(),
    backupAgeMinutes: Math.round(age / 60000),
    backupFresh: created <= now + 60000 && age <= maxBackupAge,
    freshnessLimitHours: 24,
    receiptHasMigrationRecord: !!receipt.migration,
    migrationAllowed: false,
  };
}
