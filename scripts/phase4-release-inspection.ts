import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DB, SQL } from "../server/db.js";
import {
  classifyState as classifyCollaboration,
  type DatabaseState as CollaborationState,
} from "./phase3c-release-inspection.js";
import {
  orderCatalog,
  type ChemicalCatalog,
} from "./phase4-release-catalog.js";
import {
  maxBackupAge,
  type Receipt,
} from "./phase4-production-release-core.js";
import { ReleaseError } from "./production-release-core.js";
import type { ReleaseDiagnostics } from "./phase4-release-diagnostics.js";
export const catalogHash =
  "ec41ee855d1ffb215bbac497038307be2b719c33b1039a2d6503874e60c7807d";
export function reviewedCatalog(): ChemicalCatalog {
  const bytes = readFileSync(
    fileURLToPath(new URL("./phase4-release-catalog.json", import.meta.url)),
    "utf8",
  ).replaceAll("\r\n", "\n");
  if (createHash("sha256").update(bytes).digest("hex") !== catalogHash)
    throw new ReleaseError(
      "Reviewed Phase 4 catalog differs. Release is blocked.",
    );
  return JSON.parse(bytes);
}
export async function inspectDatabase(tx: SQL) {
  const query = readFileSync(
    fileURLToPath(new URL("./phase3c-release-state.sql", import.meta.url)),
    "utf8",
  );
  const [old] = await tx.query<{ state: CollaborationState }>(query);
  const catalog = await orderCatalog(tx),
    expected = reviewedCatalog();
  const groups = Object.fromEntries(
    Object.keys(expected).map((k) => [
      k,
      JSON.stringify(catalog[k as keyof ChemicalCatalog]) ===
        JSON.stringify(expected[k as keyof ChemicalCatalog]),
    ]),
  );
  const complete = Object.values(groups).every(Boolean);
  const newSource = expected.constraints.find(
    (c) => c.relation === "notifications" && c.name === "notification_source",
  );
  const currentSource = catalog.constraints.find(
    (c) => c.relation === "notifications" && c.name === "notification_source",
  );
  const sourceMatches =
    JSON.stringify(newSource) === JSON.stringify(currentSource);
  const [history] = await tx.query<{ chemical: boolean; unknown: number }>(
    `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name='006_chemical_orders.sql') AS chemical,count(*) FILTER(WHERE name<>ALL($1::text[]))::int AS unknown FROM schema_migrations`,
    [
      [
        "001_foundation.sql",
        "002_scheduling.sql",
        "003_weekly_progress.sql",
        "004_issues_requests.sql",
        "005_meetings_notices.sql",
        "006_chemical_orders.sql",
      ],
    ],
  );
  // The old classifier checks all 001–005 safeguards. Normalize ONLY the explicitly
  // verified source replacement and known 006 ledger entry for that baseline check.
  // Report raw metadata separately; do not turn a failed catalog check into success.
  const baseline =
    classifyCollaboration({
      ...old.state,
      migrations: { ...old.state.migrations, unexpectedCount: history.unknown },
      notifications: {
        ...old.state.notifications,
        phase3cSource: old.state.notifications.phase3cSource || sourceMatches,
      },
    }).structure === "PHASE3C_STRUCTURE_PRESENT";
  const any =
    catalog.tables.length > 0 ||
    catalog.columns.length > 0 ||
    catalog.functions.length > 0 ||
    catalog.indexes.length > 0 ||
    catalog.triggers.length > 0 ||
    catalog.sequences.length > 0 ||
    catalog.constraints.some((c) => c.name !== "notification_source");
  const structure = !baseline
    ? "UNEXPECTED_BASELINE"
    : !history.chemical && !any && old.state.notifications.phase3cSource
      ? "PHASE3C_STRUCTURE_NO_006_OBJECTS"
      : history.chemical && complete
        ? "PHASE4_STRUCTURE_PRESENT"
        : "PARTIAL_OR_UNEXPECTED_006_STATE";
  return {
    structure,
    rollbackProven: false,
    recordPreservation: "NOT_ESTABLISHED_BY_CATALOG_OR_COUNTS",
    migrationAllowed: false,
    state: {
      ...old.state,
      migrations: {
        ...old.state.migrations,
        chemical: history.chemical,
        unexpectedCount: history.unknown,
      },
      orders: {
        anyObjectsPresent: any,
        catalogMatches: complete,
        checks: groups,
        sourceMatches,
      },
    },
  };
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
