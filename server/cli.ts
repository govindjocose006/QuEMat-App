import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  openDatabase,
  migrate,
  seed,
  audit,
  exportLocalDatabase,
} from "./db.js";
import { config } from "./config.js";
import { bootstrapAdmin, hashPassword } from "./auth.js";
import { credentialsSchema } from "../shared/schema.js";
process.umask(0o077);
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
async function promptCredentials() {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run in an interactive terminal. Passwords are never command-line arguments.",
    );
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const email = await rl.question("Email: ");
    process.stdout.write("Password (hidden, 12–128 characters): ");
    muted = true;
    const password = await rl.question("");
    muted = false;
    process.stdout.write("\n");
    process.stdout.write("Confirm password (hidden): ");
    muted = true;
    const confirm = await rl.question("");
    muted = false;
    process.stdout.write("\n");
    if (password !== confirm) throw new Error("Passwords do not match.");
    return credentialsSchema.parse({ email, password });
  } finally {
    muted = false;
    rl.close();
  }
}
const db = await openDatabase(config("operator").database);
try {
  switch (process.argv[2]) {
    case "migrate":
      await migrate(db);
      console.log("PostgreSQL migrations are up to date.");
      break;
    case "seed":
      await seed(db);
      console.log(
        "Instrument configuration seeded. Existing edits preserved; no member accounts created.",
      );
      break;
    case "admin": {
      const input = await promptCredentials();
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let fullName: string;
      try {
        fullName = await rl.question("Administrator full name: ");
      } finally {
        rl.close();
      }
      await bootstrapAdmin(db, input.email, input.password, fullName);
      console.log(
        "First administrator created. Sign in and verify instrument configuration.",
      );
      break;
    }
    case "reset-password": {
      const input = await promptCredentials(),
        passwordHash = await hashPassword(input.password);
      await db.write(async (tx) => {
        const [user] = await tx.query<{ id: string }>(
          "SELECT id FROM users WHERE email=$1",
          [input.email],
        );
        if (!user) throw new Error("Account not found.");
        await tx.query(
          "UPDATE users SET password_hash=$1,version=version+1 WHERE id=$2",
          [passwordHash, user.id],
        );
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
        await audit(tx, null, "account.password_reset_by_operator", user.id, {
          method: "trusted operator CLI; identity verified out of band",
        });
      });
      console.log(
        "Password reset and sessions revoked. Membership permissions are unchanged.",
      );
      break;
    }
    case "backup": {
      const target = process.argv[3];
      if (!target)
        throw new Error(
          "Usage: npm run db:backup -- /private/path/local-postgres.tar.gz (local development only)",
        );
      const destination = resolve(target);
      if (existsSync(destination))
        throw new Error("Refusing to overwrite an existing file.");
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      await exportLocalDatabase(db, destination);
      console.log(
        "Local PostgreSQL development backup created. Use Neon backups or pg_dump for hosted data.",
      );
      break;
    }
    default:
      throw new Error(
        "Choose migrate, seed, admin, reset-password, or backup.",
      );
  }
} catch (error) {
  // Database errors can contain sensitive query data. Only display safe operational messages.
  if (error instanceof Error && !("code" in error))
    console.error(error.message);
  else
    console.error(
      "Database operation failed. Check connectivity, migrations, and permissions.",
    );
  process.exitCode = 1;
} finally {
  await db.close();
}
