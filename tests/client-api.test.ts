import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api.js";
afterEach(() => vi.unstubAllGlobals());
describe("client API response recovery", () => {
  it("rejects malformed HTTP success instead of returning an error-shaped value", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>upstream outage</html>", { status: 200 }),
        ),
    );
    await expect(api("/samples")).rejects.toThrow("unexpected response");
  });
  it("keeps valid JSON null and arrays as successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(null))
        .mockResolvedValueOnce(Response.json([])),
    );
    expect(await api("/weekly/mine")).toBeNull();
    expect(await api("/samples")).toEqual([]);
  });
  it("expires a session even when the 401 body is malformed", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("expired", { status: 401 })),
    );
    await expect(api("/samples")).rejects.toBeInstanceOf(ApiError);
    expect(dispatchEvent.mock.calls[0][0].type).toBe("session-expired");
  });
  it("preserves server error messages and handles null error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ error: "Booking changed" }, { status: 409 }),
        )
        .mockResolvedValueOnce(Response.json(null, { status: 503 })),
    );
    await expect(api("/bookings", "POST", {})).rejects.toThrow(
      "Booking changed",
    );
    await expect(api("/samples")).rejects.toThrow("Request failed.");
  });
});
