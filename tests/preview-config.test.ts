import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { previewConfig } from "../scripts/preview-config.js";
const directory = mkdtempSync(join(tmpdir(), "quemat-preview-config-"));
const path = join(directory, ".env.preview");
const baseline = {
  PREVIEW_ONLY: "quemat-pr1-synthetic",
  PREVIEW_NEON_PROJECT_ID: "synthetic-preview-123",
  PREVIEW_NEON_BRANCH_ID: "br-test-preview",
  PREVIEW_NEON_HOST: "ep-test-preview.ap-southeast-1.aws.neon.tech",
  DATABASE_URL:
    "postgresql://preview:synthetic@ep-test-preview-pooler.ap-southeast-1.aws.neon.tech/quemat_pr1_preview?sslmode=require",
  DATABASE_URL_UNPOOLED:
    "postgresql://preview:synthetic@ep-test-preview.ap-southeast-1.aws.neon.tech/quemat_pr1_preview?sslmode=require",
};
function config(overrides: Partial<typeof baseline> = {}) {
  writeFileSync(
    path,
    Object.entries({ ...baseline, ...overrides })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  return previewConfig(path);
}
afterEach(() => vi.unstubAllEnvs());
it("selects only the explicit file despite injected production connection variables", () => {
  vi.stubEnv("DATABASE_URL", "production-sentinel");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "production-sentinel");
  expect(config().direct).toBe(baseline.DATABASE_URL_UNPOOLED);
});
it.each([
  { PREVIEW_NEON_PROJECT_ID: "wandering-truth-11355959" },
  { PREVIEW_NEON_HOST: "ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech" },
  {
    DATABASE_URL_UNPOOLED: baseline.DATABASE_URL_UNPOOLED.replace(
      "quemat_pr1_preview",
      "neondb",
    ),
  },
  {
    DATABASE_URL: baseline.DATABASE_URL.replace(
      "ep-test-preview-pooler",
      "ep-other-pooler",
    ),
  },
  { DATABASE_URL: baseline.DATABASE_URL.replace(":synthetic@", ":different@") },
  { PREVIEW_ONLY: "" },
  {
    DATABASE_URL_UNPOOLED:
      baseline.DATABASE_URL_UNPOOLED + "&host=production.example.test",
  },
  { DATABASE_URL: baseline.DATABASE_URL + "&database=production" },
])("rejects unsafe preview target %#", (overrides) =>
  expect(() => config(overrides)).toThrow("Refusing database"),
);
import { afterAll } from "vitest";
afterAll(() => rmSync(directory, { recursive: true, force: true }));
