import { afterEach, it, expect, vi } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type DB, type SQL, poolOptions } from "../server/db.js";
import { Client } from "pg";
import { phase3cFixture } from "./phase4-release-fixture.js";
import {
  production,
  productionConfig,
  migrationName,
  migrationHash,
  reviewedMigration,
  phase3cHistory,
  preservedTables,
  fingerprints,
  applyReviewedPhase4,
  verifyRetained,
  checkOrders,
  sequenceState,
} from "../scripts/phase4-production-release-core.js";
import {
  inspectReadOnly,
  reviewedCatalog,
} from "../scripts/phase4-release-inspection.js";
import { reviewedMigration as review005 } from "../scripts/phase3c-production-release-core.js";
let db: DB | undefined;
const dirs: string[] = [];
const migration = readFileSync(
  "server/migrations/006_chemical_orders.sql",
  "utf8",
);
async function baseline() {
  db = await openDatabase({ localPath: ":memory:" });
  const f = await phase3cFixture(db);
  return { db, ...f };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
  db = undefined;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("pins only migration 006 and its reviewed catalog, leaving previous guards unchanged", () => {
  expect(migrationName).toBe("006_chemical_orders.sql");
  expect(migrationHash).toBe(
    "05c585263f5a8c4cca896b5cf704411f1a3798048d69c24502ecfb179eb4e926",
  );
  expect(reviewedMigration(migration.replaceAll("\n", "\r\n"))).toBe(migration);
  expect(() => reviewedMigration(migration + "\nDELETE FROM users;")).toThrow();
  expect(() => review005(migration)).toThrow();
  expect(reviewedCatalog().functions).toHaveLength(2);
  expect(Object.keys(preservedTables)).toHaveLength(31);
});
it("rejects older purposes, preview/pooler targets and pins pg port/TLS despite ambient settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "p4-config-"));
  dirs.push(dir);
  const file = join(dir, "config");
  const url = `postgresql://neondb_owner:NOT_REAL@${production.host}/neondb?sslmode=require`;
  const config = (u = url, purpose = "quemat-phase4-production") => {
    writeFileSync(
      file,
      `RELEASE_PURPOSE=${purpose}\nDATABASE_URL_UNPOOLED=${u}\n`,
    );
    return productionConfig(file);
  };
  vi.stubEnv("PGPORT", "15432");
  vi.stubEnv("DATABASE_URL", "untrusted");
  const pg = new Client(poolOptions(config().url));
  expect(pg.port).toBe(5432);
  expect(pg.host).toBe(production.host);
  expect(pg.ssl).toMatchObject({ rejectUnauthorized: true });
  for (const purpose of [
    "quemat-phase3c-production",
    "quemat-phase3b-production",
    "",
  ])
    expect(() => config(url, purpose)).toThrow();
  for (const u of [
    url.replace(production.host, production.host.replace(".", "-pooler.")),
    url.replace("/neondb?", "/quemat_pr1_preview?"),
    url + "&host=other",
    url + "&options=-csearch_path=other",
  ])
    expect(() => config(u)).toThrow();
});
it("diagnoses a populated 001–005 baseline read-only without exposing records", async () => {
  const { db } = await baseline();
  const before = await fingerprints(db),
    sqls: string[] = [];
  const wrapped: DB = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            sqls.push(q);
            await tx.exec(q);
          },
        }),
      ),
  };
  const r = await inspectReadOnly(wrapped);
  expect(sqls[0]).toContain("REPEATABLE READ READ ONLY");
  expect(r.structure).toBe("PHASE3C_STRUCTURE_NO_006_OBJECTS");
  expect(r.state.migrations.chemical).toBe(false);
  expect(r.state.orders.anyObjectsPresent).toBe(false);
  expect(r.migrationAllowed).toBe(false);
  expect(JSON.stringify(r)).not.toContain("Private synthetic");
  expect(JSON.stringify(r)).not.toContain("password_hash");
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("preserves all 31 original tables, full collaboration history and numbering, with no fixtures and idempotent verification", async () => {
  const { db } = await baseline();
  const before = await fingerprints(db),
    seq = await sequenceState(db),
    guard = vi.fn(async () => {});
  const r = await applyReviewedPhase4(db, migration, undefined, guard);
  expect(guard).toHaveBeenCalledOnce();
  expect(r.before).toEqual(before);
  expect(r.after).toEqual(before);
  expect(r.before.schema_migrations.count).toBe(5);
  for (const name of [
    "meetings",
    "meeting_attendees",
    "meeting_events",
    "meeting_notes",
    "meeting_actions",
    "meeting_action_events",
    "notices",
    "notice_events",
    "notice_acknowledgements",
  ])
    expect(before[name].count).toBeGreaterThan(0);
  expect(await sequenceState(db)).toEqual(seq);
  for (const table of [
    "chemical_orders",
    "chemical_order_events",
    "chemical_deliveries",
  ])
    expect(await db.query("SELECT id FROM " + table)).toEqual([]);
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE4_STRUCTURE_PRESENT",
  );
  expect((await phase3cHistory(db)).length).toBe(6);
  await checkOrders(db);
  await verifyRetained(db, before);
  expect((await applyReviewedPhase4(db, migration)).alreadyApplied).toBe(true);
  expect(await fingerprints(db)).toEqual(before);
}, 20000);
it("refuses unknown history and partial/ledger-only states before any migration", async () => {
  const { db } = await baseline();
  await db.query(
    "INSERT INTO schema_migrations VALUES('007_unapproved.sql','synthetic')",
  );
  await expect(applyReviewedPhase4(db, migration)).rejects.toThrow(
    "Unexpected schema history",
  );
  await db.exec(
    "DELETE FROM schema_migrations WHERE name='007_unapproved.sql';CREATE SEQUENCE chemical_order_number",
  );
  expect((await inspectReadOnly(db)).structure).toBe(
    "PARTIAL_OR_UNEXPECTED_006_STATE",
  );
  await expect(applyReviewedPhase4(db, migration)).rejects.toThrow("Partial");
  await db.exec(
    "DROP SEQUENCE chemical_order_number;INSERT INTO schema_migrations VALUES('006_chemical_orders.sql','synthetic')",
  );
  await expect(applyReviewedPhase4(db, migration)).rejects.toThrow();
}, 20000);
it("blocks backup expiry inside locked transaction before DDL, preserving all rows and objects", async () => {
  const { db } = await baseline(),
    before = await fingerprints(db);
  await expect(
    applyReviewedPhase4(db, migration, undefined, async () => {
      throw Error("Synthetic backup expired while waiting");
    }),
  ).rejects.toThrow("expired");
  expect(await fingerprints(db)).toEqual(before);
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE3C_STRUCTURE_NO_006_OBJECTS",
  );
}, 20000);
it("rolls all 006 DDL and original-row changes back when preservation detects an injected modification", async () => {
  const { db } = await baseline(),
    before = await fingerprints(db);
  const wrapped: DB = {
    ...db,
    write: (fn) =>
      db.write((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            await tx.exec(q);
            if (q === migration)
              await tx.exec("UPDATE meetings SET agenda='Unexpected mutation'");
          },
        }),
      ),
  };
  await expect(applyReviewedPhase4(wrapped, migration)).rejects.toThrow(
    "Existing records changed",
  );
  expect(await fingerprints(db)).toEqual(before);
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE3C_STRUCTURE_NO_006_OBJECTS",
  );
}, 20000);
it("rejects seeded new tables and consumed new numbering rather than accepting synthetic production fixtures", async () => {
  const { db } = await baseline();
  const wrapped: DB = {
    ...db,
    write: (fn) =>
      db.write((tx) =>
        fn({
          ...tx,
          exec: async (q) => {
            await tx.exec(q);
            if (q === migration)
              await tx.query("SELECT nextval('chemical_order_number')");
          },
        }),
      ),
  };
  await expect(applyReviewedPhase4(wrapped, migration)).rejects.toThrow(
    "numbering was consumed",
  );
  expect((await inspectReadOnly(db)).structure).toBe(
    "PHASE3C_STRUCTURE_NO_006_OBJECTS",
  );
}, 20000);
it("detects disabled triggers, wrong constraint definitions, unvalidated constraints, invalid column defaults and altered function bodies", async () => {
  const { db } = await baseline();
  await applyReviewedPhase4(db, migration);
  for (const tamper of [
    "ALTER TABLE chemical_deliveries DISABLE TRIGGER chemical_deliveries_immutable",
    "ALTER TABLE chemical_orders DROP CONSTRAINT chemical_orders_check1",
    "ALTER TABLE chemical_orders ADD CONSTRAINT extra_006 CHECK(quantity>0) NOT VALID",
    "ALTER TABLE chemical_orders ALTER COLUMN received_quantity SET DEFAULT 1",
    "CREATE OR REPLACE FUNCTION protect_chemical_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN OLD; END;$$",
  ]) {
    await db.transaction(async (tx) => {
      await tx.exec("SAVEPOINT tamper");
      await tx.exec(tamper);
      await expect(checkOrders(tx)).rejects.toThrow("incomplete");
      await tx.exec("ROLLBACK TO SAVEPOINT tamper");
    });
  }
  await checkOrders(db);
}, 20000);
it("later verification permits legitimate notice changes but rejects altered original notes and revision-specific acknowledgements", async () => {
  const { db, notice } = await baseline();
  const r = await applyReviewedPhase4(db, migration);
  await db.query(
    "UPDATE notices SET body='Legitimate later correction',version=version+1 WHERE id=$1",
    [notice],
  );
  await verifyRetained(db, r.before);
  await db.exec(
    "ALTER TABLE notice_acknowledgements DISABLE TRIGGER notice_acknowledgements_immutable;DELETE FROM notice_acknowledgements WHERE version=1",
  );
  await expect(verifyRetained(db, r.before)).rejects.toThrow("missing");
}, 20000);
