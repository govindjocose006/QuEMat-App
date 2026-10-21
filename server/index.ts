import { config } from "./config.js";
import { openDatabase, migrate } from "./db.js";
import { createApp } from "./app.js";
process.umask(0o077);
const settings = config();
const db = await openDatabase(settings.database);
// Hosted production migrations are an explicit release step, never a cold-start side effect.
if (!settings.database.url) await migrate(db);
const app = createApp(db, { ...settings, serveClient: true });
const server = app.listen(settings.port, "0.0.0.0", () =>
  console.log(`QuEMat server listening on port ${settings.port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void db.close().then(() => process.exit(0));
    }),
  );
