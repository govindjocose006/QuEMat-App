import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase, seed, type DB } from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import {
  production,
  productionConfig,
  migrationHash,
  applyReviewedPhase2,
  fingerprints,
  encryptArchive,
  decryptArchive,
  fileHash,
  requireReceipt,
  type Receipt,
} from "../scripts/production-release-core.js";

let directory: string | undefined, db: DB | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
  db = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
function temporary() {
  directory = mkdtempSync(join(tmpdir(), "quemat-release-test-"));
  return directory;
}
const url =
  "postgresql://neondb_owner:synthetic-only@" +
  production.host +
  "/neondb?sslmode=require&channel_binding=require";
function config(replacement = url, purpose = "quemat-phase2-production") {
  const file = join(directory ?? temporary(), ".env.release");
  writeFileSync(
    file,
    `RELEASE_PURPOSE=${purpose}\nDATABASE_URL_UNPOOLED=${replacement}\n`,
  );
  return productionConfig(file);
}
it("ignores ambient preview/production variables and selects only the explicit guarded production file", () => {
  vi.stubEnv("DATABASE_URL", "untrusted-ambient");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "untrusted-ambient");
  expect(config().url).toBe(url);
});
it.each([
  url.replace(
    production.host,
    "ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech",
  ),
  url.replace(production.host, production.host.replace(".", "-pooler.")),
  url.replace("/neondb?", "/quemat_pr1_preview?"),
  url.replace("neondb_owner:", "preview:"),
  url + "&host=untrusted.example.test",
  url + "&database=another",
  url + "&sslrootcert=untrusted",
])(
  "rejects non-production or connection-override configuration %#",
  (replacement) => {
    expect(() => config(replacement)).toThrow("Refusing target");
  },
);
it("requires an explicit production release purpose", () =>
  expect(() => config(url, "preview")).toThrow("Refusing target"));
it("encrypts and recovers a portable archive without exposing its plaintext", async () => {
  const dir = temporary(),
    source = join(dir, "source"),
    encrypted = join(dir, "encrypted"),
    restored = join(dir, "restored");
  const content = Buffer.concat([
    Buffer.from("Synthetic-only private archive marker\n"),
    randomBytes(1024 * 1024),
  ]);
  writeFileSync(source, content);
  await encryptArchive(source, encrypted, "Synthetic-backup-passphrase-only!");
  expect(
    readFileSync(encrypted).includes(
      Buffer.from("Synthetic-only private archive marker"),
    ),
  ).toBe(false);
  await decryptArchive(
    encrypted,
    restored,
    "Synthetic-backup-passphrase-only!",
  );
  expect(await fileHash(restored)).toBe(await fileHash(source));
});
it("rejects incorrect passphrases and archive corruption, removing only its incomplete output", async () => {
  const dir = temporary(),
    source = join(dir, "source"),
    encrypted = join(dir, "encrypted"),
    out = join(dir, "out");
  writeFileSync(source, randomBytes(4096));
  await encryptArchive(source, encrypted, "Synthetic-backup-passphrase-only!");
  await expect(
    decryptArchive(encrypted, out, "Incorrect-backup-passphrase-only!"),
  ).rejects.toThrow("decryption failed");
  expect(existsSync(out)).toBe(false);
  const damaged = readFileSync(encrypted);
  damaged[damaged.length - 30] ^= 1;
  writeFileSync(encrypted, damaged);
  await expect(
    decryptArchive(encrypted, out, "Synthetic-backup-passphrase-only!"),
  ).rejects.toThrow("decryption failed");
  expect(existsSync(out)).toBe(false);
});
it("never overwrites or removes an existing backup or recovery destination", async () => {
  const dir = temporary(),
    source = join(dir, "source"),
    encrypted = join(dir, "encrypted"),
    existing = join(dir, "existing");
  writeFileSync(source, "Synthetic-only content");
  writeFileSync(existing, "KEEP");
  await expect(
    encryptArchive(source, existing, "Synthetic-backup-passphrase-only!"),
  ).rejects.toThrow();
  expect(readFileSync(existing, "utf8")).toBe("KEEP");
  await encryptArchive(source, encrypted, "Synthetic-backup-passphrase-only!");
  await expect(
    decryptArchive(encrypted, existing, "Synthetic-backup-passphrase-only!"),
  ).rejects.toThrow();
  expect(readFileSync(existing, "utf8")).toBe("KEEP");
});
it("blocks migration receipts for a different target, migration or damaged backup", async () => {
  const dir = temporary(),
    archive = join(dir, "backup.enc");
  writeFileSync(archive, randomBytes(128));
  const receipt: Receipt = {
    purpose: "quemat-phase2-production-backup-v1",
    target: production,
    migrationHash,
    archive: "backup.enc",
    cipherSha256: await fileHash(archive),
    plainSha256: "synthetic",
    bytes: statSync(archive).size,
    createdAt: new Date().toISOString(),
  };
  await expect(requireReceipt(receipt, archive)).resolves.toBeUndefined();
  await expect(
    requireReceipt(
      { ...receipt, target: { ...production, database: "preview" } },
      archive,
    ),
  ).rejects.toThrow("mismatch");
  await expect(
    requireReceipt({ ...receipt, migrationHash: "different" }, archive),
  ).rejects.toThrow("mismatch");
  writeFileSync(archive, randomBytes(128));
  await expect(requireReceipt(receipt, archive)).rejects.toThrow("mismatch");
});
async function phase1() {
  // Fresh isolated synthetic PGlite database; never loads application .env.
  db = await openDatabase({ localPath: ":memory:" });
  await db.exec(
    "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
  );
  await db.exec(
    readFileSync(resolve("server/migrations/001_foundation.sql"), "utf8"),
  );
  await db.query(
    "INSERT INTO schema_migrations VALUES('001_foundation.sql','synthetic-baseline')",
  );
  await seed(db);
  await bootstrapAdmin(
    db,
    "synthetic-release-admin@example.test",
    "Synthetic-tests-only-password!",
    "Synthetic Release Administrator",
  );
  await db.query(
    "UPDATE instruments SET description='Keep custom settings',setup_minutes=12 WHERE seed_key='initial-0'",
  );
  return db;
}
const migration = readFileSync(
  resolve("server/migrations/002_scheduling.sql"),
  "utf8",
);
it("adds only Phase 2 while preserving every legacy row and remains idempotent", async () => {
  const database = await phase1(),
    before = await fingerprints(database);
  const result = await applyReviewedPhase2(database, migration);
  expect(result.alreadyApplied).toBe(false);
  expect(result.before).toEqual(before);
  expect(result.after).toEqual(before);
  expect(result.after.instruments.count).toBe(15);
  expect((await database.query("SELECT id FROM samples")).length).toBe(0);
  expect((await database.query("SELECT id FROM bookings")).length).toBe(0);
  expect((await applyReviewedPhase2(database, migration)).alreadyApplied).toBe(
    true,
  );
  expect(await fingerprints(database)).toEqual(before);
}, 20000);
it("rejects altered migration SQL before it can change any record", async () => {
  const database = await phase1(),
    before = await fingerprints(database);
  await expect(
    applyReviewedPhase2(database, migration + "\nDROP TABLE users;"),
  ).rejects.toThrow("differs from reviewed");
  expect(await fingerprints(database)).toEqual(before);
}, 20000);
it("rolls failed DDL back without recording the migration or changing Phase 1 data", async () => {
  const database = await phase1(),
    before = await fingerprints(database);
  await database.exec("CREATE TABLE samples(marker TEXT)");
  await expect(applyReviewedPhase2(database, migration)).rejects.toThrow();
  expect(await fingerprints(database)).toEqual(before);
  expect(
    (await database.query("SELECT name FROM schema_migrations")).length,
  ).toBe(1);
  expect(
    (
      await database.query("SELECT to_regclass('public.sample_number') AS name")
    )[0].name,
  ).toBeNull();
}, 20000);
it("refuses later-phase schema histories instead of applying more migrations", async () => {
  const database = await phase1();
  await database.query(
    "INSERT INTO schema_migrations VALUES('003_unapproved.sql','synthetic')",
  );
  await expect(applyReviewedPhase2(database, migration)).rejects.toThrow(
    "Unexpected schema history",
  );
  expect(
    (await database.query("SELECT to_regclass('public.bookings') AS name"))[0]
      .name,
  ).toBeNull();
}, 20000);
it("refuses unexpected production instrument baselines without reseeding or creating data", async () => {
  const database = await phase1();
  await database.query(
    "UPDATE instruments SET seed_key=NULL WHERE seed_key='initial-14'",
  );
  await expect(applyReviewedPhase2(database, migration)).rejects.toThrow(
    "Expected production instruments",
  );
  expect((await database.query("SELECT id FROM instruments")).length).toBe(15);
  expect(
    (await database.query("SELECT to_regclass('public.bookings') AS name"))[0]
      .name,
  ).toBeNull();
}, 20000);
it("accepts the reviewed migration from a CRLF Windows checkout without changing SQL semantics", async () => {
  const database = await phase1();
  const result = await applyReviewedPhase2(
    database,
    migration.replaceAll("\n", "\r\n"),
  );
  expect(result.alreadyApplied).toBe(false);
  expect(result.after).toEqual(result.before);
}, 20000);
