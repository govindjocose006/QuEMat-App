import { afterEach, expect, it, vi } from "vitest";
import request from "supertest";
import handler from "../api/index.js";
import { config } from "../server/config.js";

afterEach(() => vi.unstubAllEnvs());
it("fails closed without a hosted database and does not expose configuration details", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("APP_ORIGIN", "https://lab.example.test");
  const result = await request(handler).get("/api/session");
  expect(result.status).toBe(503);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.body).toEqual({
    error:
      "The service is not configured or temporarily unavailable. Contact the administrator.",
  });
});
it("uses the environment-supplied preview origin and requires HTTPS", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_URL", "preview.example.test");
  vi.stubEnv("APP_ORIGIN", undefined);
  expect(config().origin).toBe("https://preview.example.test");
  vi.stubEnv("APP_ORIGIN", "http://lab.example.test");
  expect(() => config()).toThrow("HTTPS");
});
