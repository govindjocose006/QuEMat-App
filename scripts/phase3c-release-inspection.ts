import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DB, SQL } from "../server/db.js";
import type { ReleaseDiagnostics } from "./phase3c-release-diagnostics.js";
import {
  classifyState as classifyIssues,
  type DatabaseState as IssueState,
} from "./phase3b-release-inspection.js";
import {
  maxBackupAge,
  type Receipt,
} from "./phase3c-production-release-core.js";

export type DatabaseState = IssueState & {
  migrations: IssueState["migrations"] & { collaboration: boolean };
  collaborationTables: Record<string, boolean>;
  collaborationTableKinds: Record<string, boolean>;
  collaborationColumns: Record<string, boolean>;
  collaborationFunctions: Record<string, boolean>;
  collaborationFunctionBodies: Record<string, boolean>;
  collaborationTriggers: Record<string, boolean>;
  collaborationTriggersEnabled: Record<string, boolean>;
  collaborationIndexes: Record<string, boolean>;
  collaborationIndexesValid: Record<string, boolean>;
  collaborationConstraints: Record<string, boolean>;
  collaborationConstraintsValid: Record<string, boolean>;
  notifications: IssueState["notifications"] & {
    meetingColumn: boolean;
    noticeColumn: boolean;
    newColumnsNullableText: boolean;
    phase3cSource: boolean;
  };
};
const every = (v: Record<string, boolean>) =>
  Object.keys(v).length > 0 && Object.values(v).every(Boolean);
export function classifyState(state: DatabaseState) {
  // 005 replaces the old three-source rule with its pinned five-source rule.
  // Validate older structure independently of the source replacement; the actual
  // pre-004 and post-005 source definitions are checked separately below.
  // Never alter reported metadata.
  const baseline =
    classifyIssues({
      ...state,
      notifications: {
        ...state.notifications,
        phase3bSource: true,
      },
    }).structure === "PHASE3B_STRUCTURE_PRESENT";
  const presence = [
    state.collaborationTables,
    state.collaborationFunctions,
    state.collaborationTriggers,
    state.collaborationIndexes,
    state.collaborationConstraints,
  ];
  const any =
    presence.some((g) => Object.values(g).some(Boolean)) ||
    state.notifications.meetingColumn ||
    state.notifications.noticeColumn ||
    state.notifications.phase3cSource;
  const complete =
    presence.every(every) &&
    [
      state.collaborationTableKinds,
      state.collaborationColumns,
      state.collaborationFunctionBodies,
      state.collaborationTriggersEnabled,
      state.collaborationIndexesValid,
      state.collaborationConstraintsValid,
    ].every(every) &&
    state.notifications.meetingColumn &&
    state.notifications.noticeColumn &&
    state.notifications.newColumnsNullableText &&
    state.notifications.phase3cSource;
  return {
    structure: !baseline
      ? "UNEXPECTED_BASELINE"
      : !state.migrations.collaboration &&
          !any &&
          state.notifications.phase3bSource
        ? "PHASE3B_STRUCTURE_NO_005_OBJECTS"
        : state.migrations.collaboration && complete
          ? "PHASE3C_STRUCTURE_PRESENT"
          : "PARTIAL_OR_UNEXPECTED_005_STATE",
    rollbackProven: false,
    recordPreservation: "NOT_ESTABLISHED_BY_CATALOG_OR_COUNTS",
    migrationAllowed: false,
  };
}
export async function inspectDatabase(tx: SQL) {
  const query = readFileSync(
    fileURLToPath(new URL("./phase3c-release-state.sql", import.meta.url)),
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
