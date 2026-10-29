import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, authenticate } from "../src/api.js";
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

describe("idle authentication recovery", () => {
  for (const mode of ["login", "register"] as const)
    it(`bootstraps a fresh CSRF token before ${mode}`, async () => {
      const final = { user: null, csrfToken: "signed-in-token" };
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ user: null, csrfToken: "renewed-token" }),
        )
        .mockResolvedValueOnce(Response.json(final));
      vi.stubGlobal("fetch", fetch);
      expect(
        await authenticate(mode, {
          email: "synthetic@example.test",
          password: "Synthetic-only-password",
        }),
      ).toEqual(final);
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([
        "/api/session",
        `/api/auth/${mode}`,
      ]);
      expect(fetch.mock.calls[1][1].headers["X-CSRF-Token"]).toBe(
        "renewed-token",
      );
    });
  it("does not replay invalid credentials or authenticate after bootstrap failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ user: null, csrfToken: "renewed" }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "Incorrect credentials" }, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      authenticate("login", {
        email: "synthetic@example.test",
        password: "wrong",
      }),
    ).rejects.toThrow("Incorrect credentials");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch
      .mockReset()
      .mockResolvedValue(
        Response.json({ error: "Unavailable" }, { status: 503 }),
      );
    await expect(
      authenticate("register", {
        email: "synthetic@example.test",
        password: "wrong",
      }),
    ).rejects.toThrow("Unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("honours a session established in another tab without a credential write", async () => {
    const session = { user: { id: "synthetic-member" }, csrfToken: "current" };
    const fetch = vi.fn().mockResolvedValue(Response.json(session));
    vi.stubGlobal("fetch", fetch);
    expect(
      await authenticate("login", {
        email: "synthetic@example.test",
        password: "unused",
      }),
    ).toEqual(session);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
