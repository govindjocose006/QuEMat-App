// Trusted operator only. Never loads .env/.env.local, seeds data, merges or deploys.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  statSync,
  unlinkSync,
  renameSync,
  openSync,
  closeSync,
} from "node:fs";
import {
  dirname,
  resolve,
  join,
  relative,
  isAbsolute,
  sep,
  basename,
} from "node:path";
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { openDatabase, type DB } from "../server/db.js";
import {
  production,
  productionConfig,
  ReleaseError,
  fileHash,
  encryptArchive,
  decryptArchive,
  migrationName,
  migrationHash,
  reviewedMigration,
  phase3bHistory,
  fingerprints,
  applyReviewedPhase3C,
  checkMeetings,
  requireReceipt,
  verifyRetained,
  type Receipt,
} from "./phase3c-production-release-core.js";

import { ReleaseDiagnostics } from "./phase3c-release-diagnostics.js";
import {
  backupInspection,
  inspectReadOnly,
} from "./phase3c-release-inspection.js";
import { inspectNetwork } from "./phase3a-release-network.js";

const diagnostics = new ReleaseDiagnostics();
process.umask(0o077);
let db: DB | undefined;
let host = production.host;
const temporary: string[] = [];
function removeTemporary() {
  for (const path of temporary)
    try {
      unlinkSync(path);
    } catch {}
}
async function hidden(question: string) {
  if (!process.stdin.isTTY)
    throw new ReleaseError(
      "Use an interactive trusted terminal for the backup passphrase.",
    );
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(question);
  try {
    return await rl.question("");
  } finally {
    process.stdout.write("\n");
    rl.close();
  }
}
function counts(state: Awaited<ReturnType<typeof fingerprints>>) {
  return Object.fromEntries(
    Object.entries(state).map(([table, value]) => [table, value.count]),
  );
}
try {
  if (!process.argv[2])
    throw new ReleaseError(
      "Supply the explicit private release configuration path.",
    );
  const configFile = realpathSync(resolve(process.argv[2])),
    directory = dirname(configFile);
  const root = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const location = relative(root, directory);
  if (
    !location ||
    (!isAbsolute(location) &&
      location !== ".." &&
      !location.startsWith(".." + sep))
  )
    throw new ReleaseError(
      "Backups and release credentials must be outside the checkout.",
    );
  const git = spawnSync(
    "git",
    ["-C", directory, "rev-parse", "--show-toplevel"],
    { stdio: "pipe" },
  );
  if (git.error)
    throw new ReleaseError(
      "Git must be available to verify that the private directory is outside Git.",
    );
  if (git.status === 0)
    throw new ReleaseError(
      "The private release directory is inside a Git checkout.",
    );
  if (
    process.platform !== "win32" &&
    (statSync(directory).mode & 0o077 || statSync(configFile).mode & 0o077)
  )
    throw new ReleaseError(
      "Restrict the private directory to mode 700 and its config to mode 600.",
    );
  const config = productionConfig(configFile),
    action = process.argv[3];
  if (
    ![
      "preflight",
      "backup",
      "migrate",
      "verify",
      "decrypt-backup",
      "inspect-backup",
      "check-backup",
      "diagnose",
      "network-check",
    ].includes(action)
  )
    throw new ReleaseError(
      "Choose preflight, backup, migrate, verify, decrypt-backup, inspect-backup, check-backup, diagnose or network-check.",
    );
  process.chdir(root);
  diagnostics.stage("migration.hash");
  const sql = reviewedMigration(
    readFileSync("server/migrations/" + migrationName, "utf8"),
  );
  const receiptPath = join(directory, "release-receipt.json");
  const binary = (name: string) =>
    config.pgBin
      ? join(config.pgBin, name + (process.platform === "win32" ? ".exe" : ""))
      : name;
  diagnostics.stage("clients.version");
  for (const name of ["pg_dump", "pg_restore"]) {
    if (["inspect-backup", "diagnose", "network-check"].includes(action)) break;
    const version = spawnSync(binary(name), ["--version"], {
      encoding: "utf8",
    });
    if (
      version.error ||
      version.status !== 0 ||
      !new RegExp("PostgreSQL\\)? 18\\.").test(version.stdout)
    )
      throw new ReleaseError(
        "Install the free PostgreSQL 18 command-line tools and set POSTGRES_BIN in the private config. No cloud resource is needed.",
        { cause: version.error },
      );
  }
  const log = join(directory, "private-tool.log");
  const run = (
    program: string,
    args: string[],
    env: NodeJS.ProcessEnv = { ...process.env },
  ) =>
    new Promise<void>((resolveRun, reject) => {
      const fd = openSync(log, "a", 0o600);
      let finished = false;
      const finish = (error?: ReleaseError) => {
        if (finished) return;
        finished = true;
        closeSync(fd);
        error ? reject(error) : resolveRun();
      };
      const child = spawn(binary(program), args, {
        env,
        stdio: ["ignore", fd, fd],
      });
      child.once("error", (error) =>
        finish(
          new ReleaseError(
            program + " could not start. See the private log locally.",
            { cause: error },
          ),
        ),
      );
      child.once("exit", (code) =>
        finish(
          code === 0
            ? undefined
            : Object.assign(
                new ReleaseError(
                  program +
                    " failed (exit " +
                    code +
                    "). See the private log locally; do not post it publicly.",
                ),
                { nativeExitCode: code },
              ),
        ),
      );
    });
  const validate = async (archive: string) => {
    const full = join(directory, ".validation-" + randomUUID() + ".sql");
    temporary.push(full);
    diagnostics.stage("backup.archive.list");
    await run("pg_restore", ["--list", archive]);
    diagnostics.stage("backup.archive.full_read");
    await run("pg_restore", [
      "--no-owner",
      "--no-privileges",
      "--file",
      full,
      archive,
    ]);
    if (statSync(full).size === 0)
      throw new ReleaseError("Backup full-read validation failed.");
    unlinkSync(full);
  };
  const save = (receipt: Receipt, initial = false) => {
    diagnostics.stage("backup.receipt.write");
    if (initial) {
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      return;
    }
    const temp = receiptPath + "." + randomUUID() + ".tmp";
    writeFileSync(temp, JSON.stringify(receipt, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, receiptPath);
  };
  const load = async () => {
    diagnostics.stage("backup.receipt.read");
    if (!existsSync(receiptPath))
      throw new ReleaseError(
        "Create and verify the encrypted production backup first. No migration was run.",
      );
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt;
    if (basename(receipt.archive) !== receipt.archive)
      throw new ReleaseError("Invalid archive name in backup receipt.");
    const archive = join(directory, receipt.archive);
    diagnostics.stage("backup.archive.hash");
    await requireReceipt(receipt, archive, action === "migrate");
    return { receipt, archive };
  };
  const connect = async () => {
    diagnostics.stage("database.connection_and_identity");
    db = await openDatabase({ url: config.url });
    const [identity] = await db.query<{
      database: string;
      role: string;
      version: number;
      publicSchema: boolean;
    }>(
      `SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::integer AS version, current_schema()='public' AS "publicSchema"`,
    );
    if (
      identity.database !== production.database ||
      identity.role !== production.role ||
      identity.version < 180000 ||
      identity.version >= 190000 ||
      !identity.publicSchema
    )
      throw new ReleaseError(
        "Production identity/PostgreSQL version mismatch. No migration was run.",
      );
    diagnostics.stage("database.history");
    await phase3bHistory(db);
    return db;
  };
  if (action === "preflight") {
    console.log(
      JSON.stringify({
        target: production,
        migration: migrationName,
        migrationHash,
        clientTools: "PostgreSQL 18",
        databaseAccessed: false,
      }),
    );
  } else if (action === "diagnose" || action === "network-check") {
    if (action === "network-check")
      console.log(
        JSON.stringify({
          diagnosticOnly: true,
          network: await inspectNetwork(production.host, diagnostics),
          credentialsPrinted: false,
        }),
      );
    else {
      diagnostics.stage("database.connection_and_identity");
      db = await openDatabase({ url: config.url });
      console.log(
        JSON.stringify({
          diagnosticOnly: true,
          backup: "NOT_INSPECTED",
          database: await inspectReadOnly(db, diagnostics),
          credentialsPrinted: false,
        }),
      );
    }
  } else if (action === "backup") {
    if (existsSync(receiptPath)) {
      await load();
      throw new ReleaseError(
        "A verified backup receipt already exists. Use migrate/verify; keep the existing archive.",
      );
    }
    diagnostics.stage("backup.passphrase");
    const passphrase = await hidden(
      "New backup passphrase (hidden, at least 20 characters): ",
    );
    if (
      passphrase.length < 20 ||
      passphrase !== (await hidden("Confirm backup passphrase (hidden): "))
    )
      throw new ReleaseError(
        "Backup passphrases must match and contain at least 20 characters.",
      );
    diagnostics.stage("backup.credentials.prepare");
    const ca = join(directory, "public-roots.pem");
    writeFileSync(ca, rootCertificates.join("\n") + "\n", { mode: 0o600 });
    const url = new URL(config.url),
      env = { ...process.env };
    for (const name of Object.keys(env))
      if (name.toUpperCase().startsWith("PG")) delete env[name];
    const passfile = join(directory, ".pgpass-" + randomUUID());
    temporary.push(passfile);
    const escapedPassword = decodeURIComponent(url.password)
      .replaceAll("\\", "\\\\")
      .replaceAll(":", "\\:");
    writeFileSync(
      passfile,
      `${production.host}:5432:${production.database}:${production.role}:${escapedPassword}\n`,
      { mode: 0o600, flag: "wx" },
    );
    Object.assign(env, {
      PGHOST: production.host,
      PGPORT: "5432",
      PGDATABASE: production.database,
      PGUSER: production.role,
      PGPASSFILE: passfile,
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: ca,
      PGCHANNELBINDING: "require",
      PGCONNECT_TIMEOUT: "10",
    });
    const stamp =
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID().slice(0, 8);
    const raw = join(directory, ".temporary-" + stamp + ".dump");
    temporary.push(raw);
    const encrypted = join(
      directory,
      "quemat-before-phase3c-" + stamp + ".dump.enc",
    );
    const database = await connect();
    if ((await phase3bHistory(database)).includes(migrationName))
      throw new ReleaseError(
        "Phase 3C is already applied; this would not be a pre-migration backup. Stop for review.",
      );
    if (
      (await inspectReadOnly(database, diagnostics)).structure !==
      "PHASE3B_STRUCTURE_NO_005_OBJECTS"
    )
      throw new ReleaseError(
        "A pre-005 backup requires a clean verified Phase 3B structure. Stop for read-only diagnosis.",
      );
    const backupStartedAt = new Date().toISOString();
    diagnostics.stage("backup.dump");
    // pg_dump takes its own consistent MVCC snapshot; no branch/snapshot service is created.
    await run(
      "pg_dump",
      [
        "--format=custom",
        "--compress=6",
        "--no-password",
        "--lock-wait-timeout=10000",
        "--file",
        raw,
      ],
      env,
    );
    if (
      (await inspectReadOnly(database, diagnostics)).structure !==
      "PHASE3B_STRUCTURE_NO_005_OBJECTS"
    )
      throw new ReleaseError(
        "Schema changed while backing up. Preserve evidence and stop for diagnosis.",
      );
    diagnostics.stage("backup.encrypt");
    await encryptArchive(raw, encrypted, passphrase);
    const verified = join(directory, ".verified-" + stamp + ".dump");
    temporary.push(verified);
    diagnostics.stage("backup.decrypt");
    await decryptArchive(encrypted, verified, passphrase);
    diagnostics.stage("backup.plaintext.hash");
    const plainSha256 = await fileHash(raw);
    if ((await fileHash(verified)) !== plainSha256)
      throw new ReleaseError("Encrypted backup roundtrip checksum mismatch.");
    await validate(verified);
    const receipt: Receipt = {
      purpose: "quemat-phase3c-production-backup-v1",
      target: production,
      migrationHash,
      archive: basename(encrypted),
      cipherSha256: await fileHash(encrypted),
      plainSha256,
      bytes: statSync(encrypted).size,
      createdAt: backupStartedAt,
    };
    save(receipt, true);
    console.log(
      JSON.stringify({
        backup: "ENCRYPTED_AND_VERIFIED",
        fullArchiveRead: true,
        encryptedBytes: receipt.bytes,
        credentialsPrinted: false,
      }),
    );
  } else {
    const { receipt, archive } = await load();
    if (action === "inspect-backup") {
      console.log(JSON.stringify({ backup: backupInspection(receipt) }));
    } else if (
      action === "migrate" ||
      action === "decrypt-backup" ||
      action === "check-backup"
    ) {
      diagnostics.stage("backup.passphrase");
      const passphrase = await hidden("Existing backup passphrase (hidden): ");
      const verified = join(directory, ".verified-" + randomUUID() + ".dump");
      temporary.push(verified);
      diagnostics.stage("backup.decrypt");
      await decryptArchive(archive, verified, passphrase);
      diagnostics.stage("backup.plaintext.hash");
      if ((await fileHash(verified)) !== receipt.plainSha256)
        throw new ReleaseError(
          "Decrypted archive checksum mismatch. Migration is blocked.",
        );
      await validate(verified);
      if (action === "check-backup") {
        console.log(
          JSON.stringify({
            backup: {
              ...backupInspection(receipt),
              encryptionReadability: "FULL_ARCHIVE_READ_VERIFIED",
            },
            credentialsPrinted: false,
          }),
        );
      } else if (action === "decrypt-backup") {
        diagnostics.stage("backup.recovery.write");
        const recovered = join(
          directory,
          "recovered-production-" + randomUUID() + ".dump",
        );
        renameSync(verified, recovered);
        console.log(
          "Decrypted pg_dump archive saved privately beside the receipt. No database was restored.",
        );
      } else {
        // Validation/connection may take time; recheck the original receipt's
        // freshness immediately before invoking the migration, never refresh it.
        diagnostics.stage("backup.archive.hash");
        await requireReceipt(receipt, archive, true);
        const database = await connect();
        diagnostics.stage("backup.archive.hash");
        await requireReceipt(receipt, archive, true);
        const names = await phase3bHistory(database);
        if (names.includes(migrationName) && !receipt.migration)
          throw new ReleaseError(
            "005 exists without this receipt's successful preservation evidence. Stop for read-only outcome review; no blind retry.",
          );
        if (receipt.migration && !names.includes(migrationName))
          throw new ReleaseError(
            "The receipt records a migration but 005 is absent. Preserve evidence and stop for outcome review.",
          );
        if (receipt.migration)
          await verifyRetained(database, receipt.migration.before);
        const result = await applyReviewedPhase3C(
          database,
          sql,
          diagnostics,
          () => requireReceipt(receipt, archive, true),
        );
        receipt.migration = receipt.migration ?? result;
        save(receipt);
        console.log(
          JSON.stringify({
            migration: result.alreadyApplied ? "ALREADY_APPLIED" : "APPLIED",
            recordPreservation: "PASSED",
            before: counts(result.before),
            after: counts(result.after),
            fixturesRun: false,
          }),
        );
      }
    } else {
      if (!receipt.migration)
        throw new ReleaseError(
          "No successful migration receipt. Run migrate after the backup.",
        );
      const database = await connect();
      diagnostics.stage("verification");
      const verification = await database.transaction(async (tx) => {
        await tx.exec(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await tx.exec("SET LOCAL search_path=public");
        await checkMeetings(tx);
        const names = await phase3bHistory(tx);
        if (!names.includes(migrationName))
          throw new ReleaseError(
            "Phase 3C migration ledger entry is missing. Release is blocked.",
          );
        return {
          names,
          state: await verifyRetained(tx, receipt.migration!.before),
        };
      });
      const state = verification.state;
      console.log(
        JSON.stringify({
          backup: "VERIFIED",
          migrations: verification.names,
          originalRecords: "RETAINED",
          counts: counts(state),
          constraints: "VERIFIED",
          fixturesRun: false,
        }),
      );
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({ ...diagnostics.failure(error), hostname: host }),
  );
  process.exitCode = 1;
} finally {
  removeTemporary();
  try {
    await db?.close();
  } catch (error) {
    diagnostics.stage("database.close");
    console.error(
      JSON.stringify({ ...diagnostics.failure(error), hostname: host }),
    );
    process.exitCode = 1;
  }
}
