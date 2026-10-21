import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { openDatabase } from "../server/db.js";

let application: Promise<ReturnType<typeof createApp>> | undefined;
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    application ??= (async () => {
      const settings = config();
      // Never fall back to an ephemeral filesystem database in a deployed function.
      const db = await openDatabase({
        ...settings.database,
        vercel: true,
        production: true,
      });
      return createApp(db, {
        ...settings,
        vercel: true,
        production: true,
        serveClient: false,
      });
    })();
    (await application)(request, response);
  } catch {
    application = undefined;
    response.statusCode = 503;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.end(
      JSON.stringify({
        error:
          "The service is not configured or temporarily unavailable. Contact the administrator.",
      }),
    );
  }
}
