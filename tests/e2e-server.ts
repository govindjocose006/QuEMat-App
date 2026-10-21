// Synthetic accounts exist only in an isolated temporary database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate, seed } from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import { createApp } from "../server/app.js";

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
