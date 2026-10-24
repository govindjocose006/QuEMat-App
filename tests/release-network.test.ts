import { expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { lookup } from "node:dns/promises";
import {
  inspectNetwork,
  probeTcp,
} from "../scripts/phase3a-release-network.js";
import { production } from "../scripts/phase3a-production-release-core.js";
it("compares default/IPv4/IPv6 TCP profiles without addresses, credentials or database queries", async () => {
  const lookupMock = vi.fn(async () => [
    { address: "192.0.2.10", family: 4 },
    { address: "2001:db8::10", family: 6 },
  ]);
  const probe = vi.fn(
    async (_host: string, _port: number, profile: string) => ({
      reachable: profile === "ipv4",
      durationMs: 3,
    }),
  );
  const result = await inspectNetwork(production.host, undefined, {
    lookup: lookupMock as unknown as typeof lookup,
    probeTcp: probe,
  });
  expect(lookupMock).toHaveBeenCalledWith(production.host, {
    all: true,
    order: "verbatim",
  });
  expect(probe.mock.calls.map((c) => c[2])).toEqual([
    "default",
    "ipv4",
    "ipv6",
  ]);
  expect(
    probe.mock.calls.every((c) => c[0] === production.host && c[1] === 5432),
  ).toBe(true);
  expect(result).toMatchObject({
    dns: { families: { ipv4: 1, ipv6: 1 } },
    postgresConnectionVerified: false,
    credentialsSent: false,
    migrationAllowed: false,
  });
  expect(JSON.stringify(result)).not.toContain("192.0.2.10");
  expect(JSON.stringify(result)).not.toContain("2001:db8");
});
it("redacts DNS failure causes and skips address families unavailable from the resolver", async () => {
  const failed = await inspectNetwork(production.host, undefined, {
    lookup: vi.fn(async () => {
      throw Object.assign(new Error("PRIVATE url/password"), {
        code: "EAI_AGAIN",
      });
    }) as unknown as typeof lookup,
    probeTcp: vi.fn(),
  });
  expect(failed).toMatchObject({
    dns: { error: { code: "EAI_AGAIN" } },
    tcp: [],
    postgresConnectionVerified: false,
  });
  expect(JSON.stringify(failed)).not.toContain("PRIVATE");
  const probe = vi.fn(async () => ({ reachable: true, durationMs: 1 }));
  const result = await inspectNetwork(production.host, undefined, {
    lookup: vi.fn(async () => [
      { address: "192.0.2.2", family: 4 },
    ]) as unknown as typeof lookup,
    probeTcp: probe,
  });
  expect(probe).toHaveBeenCalledTimes(2);
  expect(result.tcp[2]).toMatchObject({
    profile: "ipv6",
    skipped: "NO_ADDRESS_IN_FAMILY",
  });
});
it("uses real isolated loopback sockets for explicit families and sanitizes refused connections", async () => {
  const server = createServer((socket) => socket.on("error", () => {}));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    expect((await probeTcp("127.0.0.1", port, "default", 1000)).reachable).toBe(
      true,
    );
    expect((await probeTcp("localhost", port, "ipv4", 1000)).reachable).toBe(
      true,
    );
    const ipv6 = await probeTcp("localhost", port, "ipv6", 1000);
    expect(ipv6.reachable).toBe(false);
    expect(JSON.stringify(ipv6)).not.toContain("localhost");
    expect(JSON.stringify(ipv6)).not.toContain("::1");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const refused = await probeTcp("127.0.0.1", port, "ipv4", 1000);
  expect(refused.reachable).toBe(false);
  expect(refused.error).toMatchObject({ code: "ECONNREFUSED" });
  expect(JSON.stringify(refused)).not.toContain("127.0.0.1");
});
