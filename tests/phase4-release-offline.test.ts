// Runs on Linux and a real free GitHub-hosted Windows runner. No TCP is allowed.
import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  production,
  productionConfig,
  backupPurpose,
  migrationHash,
  fileHash,
  encryptArchive,
  decryptArchive,
  requireReceipt,
  type Receipt,
} from "../scripts/phase4-production-release-core.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "quemat-006-offline-"));
  directories.push(dir);
  return dir;
}
function config(dir: string, purpose = "quemat-phase4-production") {
  const file = join(dir, ".env.production-release");
  writeFileSync(
    file,
    `RELEASE_PURPOSE=${purpose}\nDATABASE_URL_UNPOOLED=postgresql://neondb_owner:SYNTHETIC_NOT_REAL@${production.host}/neondb?sslmode=require\n`,
    { mode: 0o600 },
  );
  return file;
}
function cli(dir: string, file?: string, action = "inspect-backup") {
  const block = join(dir, "offline-no-tcp.cjs");
  writeFileSync(
    block,
    `const net=require('node:net');const original=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const arg=Array.isArray(args[0])?args[0][0]:args[0];if(typeof arg==='number'||(arg&&typeof arg==='object'&&'port' in arg))throw new Error('OFFLINE_TEST_TCP_DENIED');return original.apply(this,args)};`,
  );
  return spawnSync(
    process.execPath,
    [
      "--require",
      block,
      "--import",
      "tsx",
      resolve("scripts/phase4-production-release.ts"),
      ...(file ? [file, action] : []),
    ],
    { encoding: "utf8", timeout: 20000 },
  );
}
it("fails closed for missing configuration without any TCP connection", () => {
  const dir = temp(),
    r = cli(dir);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stderr).stage).toBe("configuration");
});
it("rejects older configuration without modifying its bytes or making TCP connections", () => {
  const dir = temp(),
    file = config(dir, "quemat-phase3c-production"),
    original = readFileSync(file);
  const r = cli(dir, file);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stderr).stage).toBe("configuration");
  expect(readFileSync(file)).toEqual(original);
});
it("rejects a missing receipt without any TCP connection or credential output", () => {
  const dir = temp(),
    file = config(dir),
    r = cli(dir, file);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stderr)).toMatchObject({
    stage: "backup.receipt.read",
    diagnostic: { guard: "BACKUP_REQUIRED" },
    credentialsPrinted: false,
  });
  expect(r.stderr).not.toContain("SYNTHETIC_NOT_REAL");
});
it("refuses private configuration inside the checkout on the current platform", () => {
  const dir = resolve(".preview", "offline-006-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  directories.push(dir);
  const r = cli(dir, config(dir));
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stderr).stage).toBe("configuration");
});
it("inspects encrypted bytes offline and preserves the original receipt, archive and backup age", async () => {
  const dir = temp(),
    file = config(dir),
    raw = join(dir, "synthetic.dump"),
    archive = join(dir, "synthetic.dump.enc"),
    recovered = join(dir, "recovered.dump");
  writeFileSync(
    raw,
    "Only synthetic archive bytes; this is not a pg_dump or production backup.",
  );
  const pass = "Synthetic offline encryption check only!";
  await encryptArchive(raw, archive, pass);
  await decryptArchive(archive, recovered, pass);
  expect(readFileSync(raw)).toEqual(readFileSync(recovered));
  const receipt: Receipt = {
    purpose: backupPurpose,
    target: production,
    migrationHash,
    archive: "synthetic.dump.enc",
    cipherSha256: await fileHash(archive),
    plainSha256: await fileHash(raw),
    bytes: readFileSync(archive).length,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  };
  const receiptPath = join(dir, "release-receipt.json");
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const originalReceipt = readFileSync(receiptPath),
    originalArchive = readFileSync(archive);
  const r = cli(dir, file);
  expect(r.status, r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({
    backup: {
      backupFresh: true,
      backupCreatedAt: receipt.createdAt,
      receiptHasMigrationRecord: false,
      migrationAllowed: false,
      encryptionReadability: "NOT_RECHECKED",
    },
  });
  expect(readFileSync(receiptPath)).toEqual(originalReceipt);
  expect(readFileSync(archive)).toEqual(originalArchive);
  expect(r.stdout + r.stderr).not.toContain("SYNTHETIC_NOT_REAL");
  await expect(
    requireReceipt(
      {
        ...receipt,
        purpose: "quemat-phase3c-production-backup-v1",
      } as unknown as Receipt,
      archive,
    ),
  ).rejects.toThrow();
  await expect(
    requireReceipt(
      { ...receipt, createdAt: new Date(Date.now() - 86400001).toISOString() },
      archive,
    ),
  ).rejects.toThrow();
});
it("pins the validated production URL port without changing the supplied configuration", () => {
  const dir = temp(),
    file = config(dir),
    original = readFileSync(file),
    selected = productionConfig(file);
  expect(new URL(selected.url).port).toBe("5432");
  expect(readFileSync(file)).toEqual(original);
});
