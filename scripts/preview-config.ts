import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// This file is deliberately independent of config() and process.env.
// A production .env, .env.local or injected DATABASE_URL cannot select the target.
export function previewConfig(path: string) {
  const env = parseEnv(readFileSync(path, "utf8"));
  const fail = () => {
    throw new Error(
      "Refusing database: use a separate preview project, matching preview endpoints, and database quemat_pr1_preview.",
    );
  };
  const project = env.PREVIEW_NEON_PROJECT_ID;
  const branch = env.PREVIEW_NEON_BRANCH_ID;
  const host = env.PREVIEW_NEON_HOST;
  if (
    env.PREVIEW_ONLY !== "quemat-pr1-synthetic" ||
    !project ||
    project === "wandering-truth-11355959" ||
    !branch?.startsWith("br-") ||
    branch === "br-flat-band-a1umhh3i" ||
    !host ||
    !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) ||
    host.startsWith("ep-round-rain-a1orsgna.") ||
    host.includes("-pooler.")
  )
    fail();
  let direct: URL, pooled: URL;
  try {
    direct = new URL(env.DATABASE_URL_UNPOOLED ?? "");
    pooled = new URL(env.DATABASE_URL ?? "");
  } catch {
    return fail();
  }
  for (const url of [direct, pooled]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.pathname !== "/quemat_pr1_preview" ||
      !url.username ||
      !url.password ||
      (url.port && url.port !== "5432") ||
      url.hash ||
      [...url.searchParams.keys()].some(
        (key) => !["sslmode", "channel_binding"].includes(key),
      )
    )
      fail();
  }
  if (
    direct.hostname !== host ||
    pooled.hostname !== host!.replace(".", "-pooler.") ||
    direct.username !== pooled.username ||
    direct.password !== pooled.password
  )
    fail();
  return {
    project: project!,
    branch: branch!,
    host: host!,
    direct: direct.toString(),
    pooled: pooled.toString(),
  };
}
