import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { config } from "../server/config.js";
import policy from "../neon.js";
import { resolveConfig } from "@neon/config/v1";

afterEach(() => vi.unstubAllEnvs());

it("loads Neon env files with local-file precedence and preserves injected secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "quemat-env-"));
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_UNPOOLED;
  // Public sentinels, never real connection credentials.
  const probe =
    "console.log(JSON.stringify([process.env.DATABASE_URL,process.env.DATABASE_URL_UNPOOLED]))";
  const args = [
    "--env-file-if-exists=.env",
    "--env-file-if-exists=.env.local",
    "-e",
    probe,
  ];
  try {
    writeFileSync(join(dir, ".env"), "DATABASE_URL=base\n");
    const run = (environment = env) =>
      JSON.parse(
        execFileSync(process.execPath, args, {
          cwd: dir,
          env: environment,
          encoding: "utf8",
        }),
      );
    expect(run()).toEqual(["base", null]);
    writeFileSync(
      join(dir, ".env.local"),
      "DATABASE_URL=pooled\nDATABASE_URL_UNPOOLED=direct\n",
    );
    expect(run()).toEqual(["pooled", "direct"]);
    expect(run({ ...env, DATABASE_URL: "injected" })).toEqual([
      "injected",
      "direct",
    ]);
    expect(
      run({ ...env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: "" }),
    ).toEqual(["", ""]);
    // The actual CLI launch path uses tsx and the same Node env-file mechanism.
    expect(
      JSON.parse(
        execFileSync(
          process.execPath,
          [resolve("node_modules/tsx/dist/cli.mjs"), ...args],
          { cwd: dir, env, encoding: "utf8" },
        ),
      ),
    ).toEqual(["pooled", "direct"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("uses pooled runtime connections and direct operator connections", () => {
  vi.stubEnv("DATABASE_URL", "pooled-sentinel");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "direct-sentinel");
  expect(config().database.url).toBe("pooled-sentinel");
  expect(config("operator").database.url).toBe("direct-sentinel");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  expect(config("operator").database.url).toBe("pooled-sentinel");
  vi.stubEnv("DATABASE_URL", "");
  expect(config("operator").database.url).toBeUndefined();
});

it("refuses new or non-production Neon branches without enabling optional services", () => {
  const branch = {
    name: "production",
    exists: true,
    isDefault: true,
    isProtected: true,
  };
  expect(() => resolveConfig(policy, branch)).not.toThrow();
  expect(() => resolveConfig(policy, { ...branch, exists: false })).toThrow(
    "existing production",
  );
  expect(() =>
    resolveConfig(policy, { ...branch, name: "another-branch" }),
  ).toThrow("existing production");
  expect(policy.auth).toBeUndefined();
  expect(policy.dataApi).toBeUndefined();
  expect(policy.aiGateway).toBeUndefined();
  expect(policy.functions).toBeUndefined();
  expect(policy.buckets).toBeUndefined();
  expect(policy.preview).toBeUndefined();
});
