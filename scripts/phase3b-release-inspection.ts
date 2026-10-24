import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DB, SQL } from "../server/db.js";
import type { ReleaseDiagnostics } from "./phase3b-release-diagnostics.js";
import {
  classifyState as classifyWeekly,
  type DatabaseState as WeeklyState,
} from "./phase3a-release-inspection.js";
import {
  maxBackupAge,
  type Receipt,
} from "./phase3b-production-release-core.js";
export type DatabaseState = WeeklyState & {
  migrations: WeeklyState["migrations"] & { issues: boolean };
  issueTables: Record<string, boolean>;
  issueSequence: boolean;
  issueSequencePresent: boolean;
  issueIndexes: Record<string, boolean>;
  issueIndexesValid: Record<string, boolean>;
  issueFunctions: Record<string, boolean>;
  issueFunctionBodies: Record<string, boolean>;
  issueTriggers: Record<string, boolean>;
  issueTriggersEnabled: Record<string, boolean>;
  issueConstraints: Record<string, boolean>;
  issueConstraintsValid: Record<string, boolean>;
  notifications: WeeklyState["notifications"] & {
    issueColumn: boolean;
    issueColumnNullable: boolean;
    phase3aSource: boolean;
    phase3bSource: boolean;
  };
};
const every = (v: Record<string, boolean>) =>
  Object.keys(v).length > 0 && Object.values(v).every(Boolean);
export function classifyState(state: DatabaseState) {
  const baseline =
    classifyWeekly(state).structure === "PHASE3A_STRUCTURE_PRESENT";
  const groups = [
    state.issueTables,
    state.issueIndexes,
    state.issueFunctions,
    state.issueTriggers,
    state.issueConstraints,
  ];
  const any =
    groups.some((g) => Object.values(g).some(Boolean)) ||
    state.issueSequencePresent ||
    state.notifications.issueColumn ||
    state.notifications.phase3bSource;
  const complete =
    groups.every(every) &&
    every(state.issueIndexesValid) &&
    every(state.issueFunctionBodies) &&
    every(state.issueTriggersEnabled) &&
    every(state.issueConstraintsValid) &&
    state.issueSequence &&
    state.notifications.issueColumn &&
    state.notifications.issueColumnNullable &&
    state.notifications.phase3bSource;
  return {
    structure: !baseline
      ? "UNEXPECTED_BASELINE"
      : !state.migrations.issues && !any && state.notifications.phase3aSource
        ? "PHASE3A_STRUCTURE_NO_004_OBJECTS"
        : state.migrations.issues && complete
          ? "PHASE3B_STRUCTURE_PRESENT"
          : "PARTIAL_OR_UNEXPECTED_004_STATE",
    rollbackProven: false,
    recordPreservation: "NOT_ESTABLISHED_BY_CATALOG_OR_COUNTS",
    migrationAllowed: false,
  };
}
export async function inspectDatabase(tx: SQL) {
  const query = readFileSync(
    fileURLToPath(new URL("./phase3b-release-state.sql", import.meta.url)),
    "utf8",
  );
  const [row] = await tx.query<{ state: DatabaseState }>(query);
  return { ...classifyState(row.state), state: row.state };
}
export async function inspectReadOnly(
  db: DB,
  diagnostics?: ReleaseDiagnostics,
) {
  diagnostics?.stage("database.read_only.begin");
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await tx.exec("SET LOCAL search_path=public");
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
    backupAgeMinutes: Math.floor(age / 60000),
    backupFresh: created <= now + 60000 && age < maxBackupAge,
    freshnessLimitHours: 24,
    receiptHasMigrationRecord: !!receipt.migration,
    migrationAllowed: false,
  };
}
