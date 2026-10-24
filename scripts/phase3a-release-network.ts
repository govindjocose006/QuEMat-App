// TCP/DNS diagnostics only. No credentials, TLS bypass, SQL or network changes.
import { lookup } from "node:dns/promises";
import { getDefaultResultOrder, type LookupAddress } from "node:dns";
import {
  Socket,
  getDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
} from "node:net";
import { performance } from "node:perf_hooks";
import {
  safeError,
  type ReleaseDiagnostics,
} from "./phase3a-release-diagnostics.js";

export type NetworkProfile = "default" | "ipv4" | "ipv6";
export function probeTcp(
  host: string,
  port: number,
  profile: NetworkProfile,
  timeoutMs = 10000,
) {
  return new Promise<{
    reachable: boolean;
    durationMs: number;
    error?: ReturnType<typeof safeError>;
  }>((resolve) => {
    const socket = new Socket(),
      start = performance.now();
    let finished = false;
    const finish = (reachable: boolean, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        reachable,
        durationMs: Math.round(performance.now() - start),
        ...(error ? { error: safeError(error) } : {}),
      });
    };
    const timer = setTimeout(
      () => finish(false, Object.assign(new Error(), { code: "ETIMEDOUT" })),
      timeoutMs,
    );
    socket.once("connect", () => finish(true));
    socket.on("error", (error) => finish(false, error));
    const options =
      profile === "default"
        ? { host, port }
        : {
            host,
            port,
            family: profile === "ipv4" ? 4 : 6,
            autoSelectFamily: false,
          };
    try {
      socket.connect(options);
    } catch (error) {
      finish(false, error);
    }
  });
}
export async function inspectNetwork(
  host: string,
  diagnostics?: ReleaseDiagnostics,
  deps = { lookup, probeTcp },
) {
  const runtime = {
    node: process.version,
    platform: process.platform,
    dnsResultOrder: getDefaultResultOrder(),
    autoSelectFamily: getDefaultAutoSelectFamily(),
    autoSelectAttemptTimeoutMs: getDefaultAutoSelectFamilyAttemptTimeout(),
    ambientPgPortPresent: process.env.PGPORT !== undefined,
    ambientPgPortMatchesTarget:
      process.env.PGPORT === undefined
        ? null
        : Number(process.env.PGPORT) === 5432,
  };
  diagnostics?.stage("network.dns");
  let addresses: LookupAddress[];
  try {
    addresses = await deps.lookup(host, {
      all: true,
      order: "verbatim",
    });
  } catch (error) {
    return {
      hostname: host,
      port: 5432,
      runtime,
      dns: { error: safeError(error) },
      tcp: [],
      postgresConnectionVerified: false,
      credentialsSent: false,
      migrationAllowed: false,
    };
  }
  const families = {
    ipv4: addresses.filter((x) => x.family === 4).length,
    ipv6: addresses.filter((x) => x.family === 6).length,
  };
  const tcp = [];
  for (const profile of ["default", "ipv4", "ipv6"] as const) {
    if (profile !== "default" && families[profile] === 0) {
      tcp.push({ profile, skipped: "NO_ADDRESS_IN_FAMILY" });
      continue;
    }
    diagnostics?.stage(`network.tcp.${profile}`);
    tcp.push({ profile, ...(await deps.probeTcp(host, 5432, profile)) });
  }
  return {
    hostname: host,
    port: 5432,
    runtime,
    dns: { families },
    tcp,
    postgresConnectionVerified: false,
    credentialsSent: false,
    migrationAllowed: false,
  };
}
