// Run with node --import tsx; never with the npm db:* scripts' .env loaders.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { previewConfig } from "./preview-config.js";
import { openDatabase, migrate, seed, type DB } from "../server/db.js";
import { bootstrapAdmin, hashPassword } from "../server/auth.js";
import { weeklyPreviewFixtures } from "./weekly-preview-fixtures.js";

process.umask(0o077);
const file = resolve(process.argv[2] ?? ".env.preview");
const action = process.argv[3];
const target = previewConfig(file);
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
if (
  ![
    "prepare",
    "fixtures",
    "weekly-fixtures",
    "verify",
    "admin",
    "reset-password",
  ].includes(action)
)
  throw new Error(
    "Choose prepare, fixtures, weekly-fixtures, verify, admin or reset-password.",
  );
let db: DB | undefined;
async function marker() {
  const rows = await db!.query<{
    project_id: string;
    branch_id: string;
    host: string;
  }>(
    "SELECT project_id,branch_id,host FROM quemat_preview_identity WHERE id=1",
  );
  if (
    rows.length !== 1 ||
    rows[0].project_id !== target.project ||
    rows[0].branch_id !== target.branch ||
    rows[0].host !== target.host
  )
    throw new Error("Preview identity mismatch. No operation was performed.");
}
try {
  db = await openDatabase({ url: target.direct });
  const [identity] = await db.query<{ name: string; role: string }>(
    "SELECT current_database() AS name,current_user AS role",
  );
  if (identity.name !== "quemat_pr1_preview")
    throw new Error("Wrong preview database.");
  if (action === "prepare") {
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    if (!tables.some((t) => t.table_name === "quemat_preview_identity")) {
      if (tables.length)
        throw new Error("Preview preparation requires an empty database.");
      await db.transaction(async (tx) => {
        await tx.exec(
          "CREATE TABLE quemat_preview_identity(id INTEGER PRIMARY KEY CHECK(id=1),project_id TEXT NOT NULL,branch_id TEXT NOT NULL,host TEXT NOT NULL)",
        );
        await tx.query(
          "INSERT INTO quemat_preview_identity VALUES(1,$1,$2,$3)",
          [target.project, target.branch, target.host],
        );
      });
    }
    await marker();
    if (
      (await db.query("SELECT to_regclass('public.users') AS name"))[0].name &&
      (
        await db.query(
          "SELECT id FROM users WHERE email NOT LIKE '%@example.test'",
        )
      ).length
    )
      throw new Error(
        "Refusing preview migration: non-synthetic accounts detected.",
      );
    await migrate(db);
    await seed(db);
    console.log("Preview-only migrations and 15 instrument seeds applied.");
  } else {
    await marker();
  }
  if (action === "fixtures") {
    const definitions = [
      ["admin", "Preview Administrator", "approved"],
      ["member", "Preview Member", "approved"],
      ["other", "Preview Other Member", "approved"],
      ["pending", "Preview Pending Member", "pending"],
    ];
    const emails = definitions.map(([key]) => `preview-${key}@example.test`);
    const foreign = await db.query(
      "SELECT id FROM users WHERE NOT(email=ANY($1::text[]))",
      [emails],
    );
    if (foreign.length)
      throw new Error(
        "Refusing fixtures: database contains accounts outside the synthetic fixture set.",
      );
    const credentialsPath = resolve(
      dirname(file),
      ".env.preview-accounts.json",
    );
    const credentials: Record<string, { email: string; password: string }> =
      existsSync(credentialsPath)
        ? JSON.parse(readFileSync(credentialsPath, "utf8"))
        : Object.fromEntries(
            definitions.map(([key], i) => [
              key,
              {
                email: emails[i],
                password: randomBytes(30).toString("base64url"),
              },
            ]),
          );
    for (const [key] of definitions) {
      if (
        credentials[key]?.email !== `preview-${key}@example.test` ||
        typeof credentials[key]?.password !== "string" ||
        credentials[key].password.length < 24
      )
        throw new Error("Invalid private preview account file.");
    }
    if (!existsSync(credentialsPath))
      writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    const admin = credentials.admin;
    if (
      !(await db.query("SELECT id FROM users WHERE email=$1", [admin.email]))
        .length
    )
      await bootstrapAdmin(
        db,
        admin.email,
        admin.password,
        "Preview Administrator",
      );
    for (const [key, name, status] of definitions.slice(1)) {
      const account = credentials[key];
      await db.query(
        `INSERT INTO users(id,email,password_hash,full_name,status,onboarded,academic_role,project,created_at)
        VALUES($1,$2,$3,$4,$5,1,'PhD student','Synthetic preview',now()) ON CONFLICT(email) DO NOTHING`,
        [
          randomUUID(),
          account.email,
          await hashPassword(account.password),
          name,
          status,
        ],
      );
    }
    const [owner] = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1",
      [credentials.member.email],
    );
    for (const compound of ["FeSe — synthetic", "MnO2 — synthetic"])
      await db.query(
        `INSERT INTO samples(id,owner_id,compound,project,batch,origin,notes)
        SELECT $1,$2,$3,'Synthetic preview','PR1 preview fixtures','internal','Demo only; no physical sample'
        WHERE NOT EXISTS(SELECT 1 FROM samples WHERE batch='PR1 preview fixtures' AND compound=$3)`,
        [randomUUID(), owner.id, compound],
      );
    console.log(
      "Synthetic preview accounts and samples ready. Passwords saved only in .env.preview-accounts.json beside the selected config.",
    );
  }
  if (action === "weekly-fixtures") {
    await weeklyPreviewFixtures(
      db,
      resolve(dirname(file), ".env.weekly-accounts.json"),
    );
    console.log(
      "Synthetic weekly mentor, mentee, supervisor and other member ready. Passwords are only in .env.weekly-accounts.json beside the private preview config. Existing accounts were preserved.",
    );
  }
  if (action === "verify") {
    const migrations = await db.query(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    const [counts] = await db.query(
      "SELECT (SELECT count(*) FROM instruments) AS instruments,(SELECT count(*) FROM users) AS accounts,(SELECT count(*) FROM samples) AS samples",
    );
    console.log(
      JSON.stringify({
        host: target.host,
        database: identity.name,
        migrations,
        counts,
      }),
    );
  }
  if (action === "admin" || action === "reset-password") {
    await db.close();
    db = undefined;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/cli.ts", action],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: target.pooled,
          DATABASE_URL_UNPOOLED: target.direct,
          NODE_ENV: "production",
          VERCEL: "0",
          APP_ORIGIN: "https://preview-operator.invalid",
        },
      },
    );
    process.exitCode = child.status ?? 1;
  }
} catch (error) {
  if (error instanceof Error && !("code" in error))
    console.error(error.message);
  else {
    const e = error as { code?: string; syscall?: string };
    console.error(
      JSON.stringify({
        error: "Preview database operation failed",
        code: e.code,
        syscall: e.syscall,
        hostname: target.host,
      }),
    );
  }
  process.exitCode = 1;
} finally {
  await db?.close();
}
