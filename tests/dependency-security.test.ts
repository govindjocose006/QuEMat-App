import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { createServer, request } from "node:http";
import { gzipSync } from "node:zlib";
import { createApp } from "../server/app.js";
import type { DB } from "../server/db.js";
it("retains Vercel config/auth schema behavior with the patched shared Zod", () => {
  const fromSDK = createRequire(import.meta.resolve("@vercel/functions"));
  const fromOidc = createRequire(fromSDK.resolve("@vercel/oidc"));
  const { parseGlobalConfig, parseAuthConfig } = fromOidc("@vercel/cli-config");
  expect(
    parseGlobalConfig({
      currentTeam: "synthetic-team",
      telemetry: { enabled: false },
      credStorage: "file",
    }),
  ).toMatchObject({
    currentTeam: "synthetic-team",
    telemetry: { enabled: false },
    credStorage: "file",
  });
  expect(
    parseAuthConfig({
      token: "synthetic-only",
      expiresAt: 123,
      skipWrite: true,
    }),
  ).toMatchObject({ token: "synthetic-only", expiresAt: 123, skipWrite: true });
  expect(() =>
    parseGlobalConfig({ telemetry: { enabled: "invalid" } }),
  ).toThrow();
  expect(() => parseAuthConfig({ token: ["invalid"] })).toThrow();
});
it("keeps the HTTP process responsive after compressed JSON with invalid trailing bytes", async () => {
  // Body parsing precedes all database work; no real database can be selected.
  const unused = async () => {
    throw new Error("Unexpected database access");
  };
  const db: DB = {
    query: unused,
    exec: unused,
    write: unused,
    transaction: unused,
    close: async () => {},
  };
  const server = createServer(
    createApp(db, { origin: "http://localhost:5173" }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  async function send(path: string, body: Buffer, encoding?: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length,
            ...(encoding ? { "Content-Encoding": encoding } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  try {
    const encoded = Buffer.concat([
      gzipSync(Buffer.from('{"synthetic":true}')),
      Buffer.from("invalid gzip trailer"),
    ]);
    const bad = await send("/api/does-not-exist", encoded, "gzip");
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThanOrEqual(500);
    const next = await send("/api/does-not-exist", Buffer.from("{"));
    expect(next.status).toBe(400);
    expect(next.body).toContain("Invalid JSON request");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
