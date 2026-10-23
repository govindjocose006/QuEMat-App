// Synthetic accounts exist only in an isolated temporary database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  migrate,
  seed,
  instruments,
  saveInstrument,
} from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { randomUUID } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "quemat-browser-"));
const db = await openDatabase({ localPath: join(dir, "postgres") });
await migrate(db);
await seed(db);
await bootstrapAdmin(
  db,
  "browser-admin@example.test",
  "Browser-tests-only-passphrase!",
  "Test Administrator",
);
const [browserAdmin] = await db.query<{ password_hash: string }>(
  "SELECT password_hash FROM users WHERE email='browser-admin@example.test'",
);
for (const device of ["desktop", "phone"]) {
  const ppms = (await instruments(db)).find((i) => i.name === "PPMS")!;
  await saveInstrument(
    db,
    { ...ppms, name: `Weekly ${device} PPMS`, priority: false },
    randomUUID(),
    false,
  );
  const mentorId = randomUUID();
  for (const [key, role, academic] of [
    ["mentor", "mentor", "PhD student"],
    ["member", "member", "Intern"],
    ["supervisor", "supervisor", "Supervisor"],
    ["other", "member", "Supervisor"],
  ])
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,academic_role,mentor_id,project,created_at) VALUES($1,$2,$3,$4,$5,'approved',1,$6,$7,$8,'2020-01-01T00:00:00Z')",
      [
        key === "mentor" ? mentorId : randomUUID(),
        `browser-weekly-${key}-${device}@example.test`,
        browserAdmin.password_hash,
        `Weekly ${device} ${key}`,
        role,
        academic,
        key === "member" ? mentorId : null,
        `Weekly ${device}`,
      ],
    );
}
const app = createApp(db, {
  origin: "http://127.0.0.1:3199",
  serveClient: true,
  authLimit: 1000,
});
const server = app.listen(3199, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    }),
  );
