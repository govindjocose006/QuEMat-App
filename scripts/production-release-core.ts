import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  openSync,
  closeSync,
  readSync,
  writeSync,
  appendFileSync,
  unlinkSync,
  statSync,
  readFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { parseEnv } from "node:util";
import type { DB, SQL } from "../server/db.js";

export const production = {
  project: "wandering-truth-11355959",
  branch: "br-flat-band-a1umhh3i",
  host: "ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech",
  database: "neondb",
  role: "neondb_owner",
};
export const migrationName = "002_scheduling.sql";
export const migrationHash =
  "29a46df505aa64677f07d3916d7da5ea17dc5151099b7a2a23adce46370c6b06";
export class ReleaseError extends Error {}
export function reviewedMigration(sql: string) {
  // Git for Windows may check text out with CRLF; hash the reviewed LF bytes.
  const normalized = sql.replaceAll("\r\n", "\n");
  if (createHash("sha256").update(normalized).digest("hex") !== migrationHash)
    throw new ReleaseError(
      "Migration differs from reviewed PR #1. No SQL was executed.",
    );
  return normalized;
}
export function productionConfig(file: string) {
  // Explicit file only. Ambient DATABASE_URL and ordinary .env files are ignored.
  const env = parseEnv(readFileSync(file, "utf8"));
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL_UNPOOLED ?? "");
  } catch {
    throw new ReleaseError(
      "Invalid explicit production release configuration.",
    );
  }
  if (
    env.RELEASE_PURPOSE !== "quemat-phase2-production" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== production.host ||
    url.pathname !== "/" + production.database ||
    decodeURIComponent(url.username) !== production.role ||
    !url.password ||
    (url.port && url.port !== "5432") ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !["sslmode", "channel_binding"].includes(key),
    )
  )
    throw new ReleaseError(
      "Refusing target: this command requires the verified direct production endpoint, neondb and neondb_owner.",
    );
  return { url: url.toString(), pgBin: env.POSTGRES_BIN };
}
export async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const magic = "QUEMAT-PG18-AES256GCM-V1\n";
function keyFor(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
export async function encryptArchive(
  source: string,
  destination: string,
  passphrase: string,
) {
  if (passphrase.length < 20)
    throw new ReleaseError(
      "Use a unique backup passphrase of at least 20 characters.",
    );
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = keyFor(passphrase, salt);
  const header = Buffer.from(
    magic +
      JSON.stringify({ salt: salt.toString("hex"), iv: iv.toString("hex") }) +
      "\n",
  );
  const fd = openSync(destination, "wx", 0o600);
  let output: ReturnType<typeof createWriteStream> | undefined;
  try {
    writeSync(fd, header);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    output = createWriteStream(destination, { fd, autoClose: true });
    await pipeline(createReadStream(source), cipher, output);
    appendFileSync(destination, cipher.getAuthTag());
  } catch (error) {
    if (output) output.destroy();
    else
      try {
        closeSync(fd);
      } catch {}
    try {
      unlinkSync(destination);
    } catch {}
    throw error;
  } finally {
    key.fill(0);
  }
}
export async function decryptArchive(
  source: string,
  destination: string,
  passphrase: string,
) {
  const fd = openSync(source, "r"),
    size = statSync(source).size;
  const first = Buffer.alloc(Math.min(4096, size));
  readSync(fd, first, 0, first.length, 0);
  const start = first.indexOf("\n", magic.length);
  if (
    !first.subarray(0, magic.length).equals(Buffer.from(magic)) ||
    start < 0 ||
    size < start + 18
  ) {
    closeSync(fd);
    throw new ReleaseError("Invalid encrypted backup format.");
  }
  const header = first.subarray(0, start + 1);
  let parameters: { salt: string; iv: string };
  try {
    parameters = JSON.parse(first.subarray(magic.length, start).toString());
  } catch {
    closeSync(fd);
    throw new ReleaseError("Invalid encrypted backup header.");
  }
  if (
    !/^[a-f0-9]{32}$/.test(parameters.salt) ||
    !/^[a-f0-9]{24}$/.test(parameters.iv)
  ) {
    closeSync(fd);
    throw new ReleaseError("Invalid encrypted backup parameters.");
  }
  const tag = Buffer.alloc(16);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  const key = keyFor(passphrase, Buffer.from(parameters.salt, "hex"));
  // Exclusive open precedes cleanup: an existing destination is never removed.
  const output = openSync(destination, "wx", 0o600);
  let stream: ReturnType<typeof createWriteStream> | undefined;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parameters.iv, "hex"),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    stream = createWriteStream(destination, { fd: output, autoClose: true });
    await pipeline(
      createReadStream(source, { start: header.length, end: size - 17 }),
      decipher,
      stream,
    );
  } catch {
    if (stream) stream.destroy();
    else
      try {
        closeSync(output);
      } catch {}
    try {
      unlinkSync(destination);
    } catch {}
    throw new ReleaseError(
      "Backup decryption failed: wrong passphrase or damaged archive. Migration is blocked.",
    );
  } finally {
    key.fill(0);
  }
}
export const legacyTables = [
  "users",
  "instruments",
  "training_entries",
  "sop_links",
  "audit_events",
  "write_lock",
] as const;
export async function fingerprints(tx: SQL) {
  const result: Record<
    string,
    { count: number; sha256: string; ids: unknown[] }
  > = {};
  for (const table of legacyTables) {
    const rows = await tx.query<{ id: unknown }>(
      `SELECT * FROM ${table} ORDER BY id`,
    );
    result[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      ids: rows.map((row) => row.id),
    };
  }
  return result;
}
export async function phase1History(tx: SQL) {
  const names = (
    await tx.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    )
  ).map((row) => row.name);
  if (
    !names.includes("001_foundation.sql") ||
    names.some((n) => !["001_foundation.sql", migrationName].includes(n))
  )
    throw new ReleaseError(
      "Unexpected schema history. No initialization or later-phase migration is permitted.",
    );
  return names;
}
export async function checkScheduling(tx: SQL) {
  for (const table of [
    "samples",
    "bookings",
    "booking_samples",
    "availability_windows",
    "notifications",
  ])
    if (
      !(
        await tx.query("SELECT to_regclass($1) AS name", ["public." + table])
      )[0]?.name
    )
      throw new ReleaseError("Phase 2 schema verification failed.");
  const checks = await tx.query<{
    conflict: boolean;
    actual: boolean;
    guard: boolean;
    extension: boolean;
  }>(`SELECT
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='bookings_no_overlap' AND contype='x') AS conflict,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='one_actual_operator' AND indexdef LIKE 'CREATE UNIQUE%') AS actual,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='enforce_booking' AND NOT tgisinternal) AS guard,
    EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist') AS extension`);
  if (
    !checks[0]?.conflict ||
    !checks[0]?.actual ||
    !checks[0]?.guard ||
    !checks[0]?.extension
  )
    throw new ReleaseError(
      "Phase 2 booking constraint/trigger verification failed.",
    );
}
export async function applyReviewedPhase2(db: DB, sql: string) {
  const reviewed = reviewedMigration(sql);
  return db.write(async (tx) => {
    const names = await phase1History(tx),
      before = await fingerprints(tx);
    const seeds = await tx.query(
      "SELECT seed_key FROM instruments WHERE seed_key=ANY($1::text[])",
      [Array.from({ length: 15 }, (_, i) => `initial-${i}`)],
    );
    if (
      seeds.length !== 15 ||
      !(
        await tx.query(
          "SELECT id FROM users WHERE app_role='administrator' AND status='approved'",
        )
      ).length
    )
      throw new ReleaseError(
        "Expected production instruments or active administrator are missing. No migration was applied.",
      );
    if (!names.includes(migrationName)) {
      await tx.exec(reviewed);
      await tx.query(
        "INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2)",
        [migrationName, new Date().toISOString()],
      );
    }
    await checkScheduling(tx);
    const after = await fingerprints(tx);
    for (const table of legacyTables)
      if (before[table].sha256 !== after[table].sha256)
        throw new ReleaseError(
          "Existing records changed during migration. The transaction was rolled back.",
        );
    return {
      alreadyApplied: names.includes(migrationName),
      before,
      after,
      appliedAt: new Date().toISOString(),
    };
  });
}
export type Receipt = {
  purpose: "quemat-phase2-production-backup-v1";
  target: typeof production;
  migrationHash: string;
  archive: string;
  cipherSha256: string;
  plainSha256: string;
  bytes: number;
  createdAt: string;
  migration?: Awaited<ReturnType<typeof applyReviewedPhase2>>;
};
export async function requireReceipt(receipt: Receipt, archive: string) {
  if (
    receipt.purpose !== "quemat-phase2-production-backup-v1" ||
    JSON.stringify(receipt.target) !== JSON.stringify(production) ||
    receipt.migrationHash !== migrationHash ||
    statSync(archive).size !== receipt.bytes ||
    (await fileHash(archive)) !== receipt.cipherSha256
  )
    throw new ReleaseError(
      "Backup receipt/target/checksum mismatch. Migration is blocked.",
    );
}
