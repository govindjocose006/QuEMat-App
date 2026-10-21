import { resolve } from "node:path";
import { z } from "zod";
export function config() {
  const vercel = process.env.VERCEL === "1";
  const production = process.env.NODE_ENV === "production" || vercel;
  const originValue =
    process.env.APP_ORIGIN ??
    (vercel && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : production
        ? undefined
        : "http://localhost:5173");
  if (!originValue)
    throw new Error(
      "Production requires APP_ORIGIN or a Vercel deployment URL.",
    );
  const origin = new URL(originValue);
  if (production && origin.protocol !== "https:")
    throw new Error("Production requires an HTTPS origin.");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("APP_ORIGIN must contain only an HTTP(S) origin.");
  return {
    vercel,
    production,
    origin: origin.origin,
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(process.env.PORT ?? 3100),
    trustProxyHops: z.coerce
      .number()
      .int()
      .min(0)
      .max(5)
      .parse(process.env.TRUST_PROXY_HOPS ?? 0),
    database: {
      url: process.env.DATABASE_URL || undefined,
      localPath: resolve(process.env.LOCAL_DATABASE_PATH ?? "data/postgres"),
      vercel,
      production,
    },
  };
}
