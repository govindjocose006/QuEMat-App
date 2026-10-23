import { Pool, type PoolClient } from "pg";
import lockfile from "proper-lockfile";
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Instrument, InstrumentInput, Member } from "../shared/schema.js";
import { initialInstruments } from "./seed-data.js";

export interface SQL {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]>;
  exec(sql: string): Promise<void>;
}
export interface DB extends SQL {
  transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  write<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  local?: PGlite;
}
export type DatabaseOptions = {
  url?: string;
  localPath?: string;
  vercel?: boolean;
  production?: boolean;
};
export function poolOptions(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  // Explicit verification must not be replaced by sslmode=require from a provider URL.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    parsed.searchParams.delete(key);
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: true },
    enableChannelBinding: true,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  };
}
export async function openDatabase(options: DatabaseOptions = {}): Promise<DB> {
  if ((options.vercel || options.production) && !options.url)
    throw new Error(
      "DATABASE_URL is required for Vercel/production. Local storage is development-only.",
    );
  let query: SQL["query"],
    exec: SQL["exec"],
    transaction: DB["transaction"],
    close: DB["close"];
  let local: PGlite | undefined;
  if (options.url) {
    const pool = new Pool(poolOptions(options.url));
    pool.on("error", () => console.error("Database pool connection failed."));
    if (options.vercel) attachDatabasePool(pool);
    const sqlClient = (client: Pool | PoolClient): SQL => ({
      async query<T>(sql: string, values: unknown[] = []) {
        return (await client.query(sql, values)).rows as T[];
      },
      async exec(sql) {
        await client.query(sql);
      },
    });
    ({ query, exec } = sqlClient(pool));
    transaction = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(sqlClient(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    close = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { btree_gist } =
      await import("@electric-sql/pglite/contrib/btree_gist");
    const path = options.localPath ?? "data/postgres";
    if (path !== ":memory:")
      mkdirSync(resolve(path), { recursive: true, mode: 0o700 });
    let release: (() => Promise<void>) | undefined;
    if (path !== ":memory:") {
      try {
        release = await lockfile.lock(resolve(path), {
          stale: 30000,
          update: 10000,
        });
      } catch {
        throw new Error(
          "The local development database is in use. Stop the local server before running database commands.",
        );
      }
    }
    try {
      local = await PGlite.create(
        path === ":memory:" ? undefined : resolve(path),
        { extensions: { btree_gist } },
      );
    } catch (error) {
      await release?.();
      throw error;
    }
    const pg = local;
    query = async <T>(sql: string, values: unknown[] = []) =>
      (await pg.query<T>(sql, values)).rows;
    exec = async (sql) => {
      await pg.exec(sql);
    };
    transaction = (fn) =>
      pg.transaction(async (tx) =>
        fn({
          async query<T>(sql: string, values: unknown[] = []) {
            return (await tx.query<T>(sql, values)).rows;
          },
          async exec(sql) {
            await tx.exec(sql);
          },
        }),
      );
    close = async () => {
      try {
        await pg.close();
      } finally {
        await release?.();
      }
    };
  }
  return {
    query,
    exec,
    transaction,
    close,
    local,
    write: (fn) =>
      transaction(async (tx) => {
        // Serializes Phase 1 writes across instances, protecting last-admin and mentor invariants.
        await tx.query("SELECT id FROM write_lock WHERE id=1 FOR UPDATE");
        return fn(tx);
      }),
  };
}
export async function migrate(db: DB) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS write_lock (id INTEGER PRIMARY KEY); INSERT INTO write_lock VALUES (1) ON CONFLICT DO NOTHING;",
  );
  await db.write(async (tx) => {
    for (const name of readdirSync(resolve("server/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (
          await tx.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).length
      )
        continue;
      await tx.exec(readFileSync(resolve("server/migrations", name), "utf8"));
      await tx.query("INSERT INTO schema_migrations VALUES ($1,$2)", [
        name,
        new Date().toISOString(),
      ]);
    }
  });
}
export async function audit(
  db: SQL,
  actor: string | null,
  action: string,
  entityId: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_events(id,actor_id,action,entity_id,details,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      actor,
      action,
      entityId,
      JSON.stringify(details),
      new Date().toISOString(),
    ],
  );
}
export async function member(db: SQL, id: string): Promise<Member | null> {
  const [row] = await db.query<Member>(
    `SELECT u.id,u.email,u.full_name AS "fullName",u.academic_role AS "academicRole",u.project,
    u.mentor_id AS "mentorId",u.mentor_pending AS "mentorPending",u.app_role AS "appRole",u.status,u.onboarded,u.version,
    u.created_at AS "createdAt",m.full_name AS "mentorName" FROM users u LEFT JOIN users m ON u.mentor_id=m.id WHERE u.id=$1`,
    [id],
  );
  return row
    ? {
        ...row,
        onboarded: Boolean(row.onboarded),
        mentorPending: Boolean(row.mentorPending),
      }
    : null;
}
export async function instruments(
  db: SQL,
  archived = false,
): Promise<Instrument[]> {
  const rows =
    await db.query<Instrument>(`SELECT id,name,category,location,description,status,priority,max_temperature_c AS "maxTemperatureC",
    booking_rules AS "bookingRules",scheduling_mode AS "schedulingMode",coordinator_approval AS "coordinatorApproval",
    setup_minutes AS "setupMinutes",cleanup_minutes AS "cleanupMinutes",training_policy AS "trainingPolicy",training_note AS "trainingNote",
    archived,sort_order AS "sortOrder",version,updated_at AS "updatedAt" FROM instruments ${archived ? "" : "WHERE archived=0"} ORDER BY priority DESC, sort_order, name`);
  const training = await db.query<{ instrument_id: string; name: string }>(
    "SELECT instrument_id,name FROM training_entries ORDER BY id",
  );
  const links = await db.query<{
    instrument_id: string;
    label: string;
    url: string;
  }>("SELECT instrument_id,label,url FROM sop_links ORDER BY id");
  return rows.map((row) => ({
    ...row,
    priority: Boolean(row.priority),
    coordinatorApproval: Boolean(row.coordinatorApproval),
    archived: Boolean(row.archived),
    trainedUsers: training
      .filter((r) => r.instrument_id === row.id)
      .map((r) => r.name),
    sopLinks: links
      .filter((r) => r.instrument_id === row.id)
      .map(({ label, url }) => ({ label, url })),
  }));
}
export async function saveInstrument(
  db: SQL,
  input: InstrumentInput,
  id: string,
  existing: boolean,
  seedKey: string | null = null,
  sortOrder = 100,
) {
  const record: Record<string, unknown> = {
    name: input.name,
    category: input.category,
    location: input.location,
    description: input.description,
    status: input.status,
    priority: +input.priority,
    max_temperature_c: input.maxTemperatureC,
    booking_rules: input.bookingRules,
    scheduling_mode: input.schedulingMode,
    coordinator_approval: +input.coordinatorApproval,
    setup_minutes: input.setupMinutes,
    cleanup_minutes: input.cleanupMinutes,
    training_policy: input.trainingPolicy,
    training_note: input.trainingNote,
    archived: +input.archived,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const fields = Object.keys(record);
    await db.query(
      `UPDATE instruments SET ${fields.map((k, i) => `${k}=$${i + 1}`).join(",")},version=version+1 WHERE id=$${fields.length + 1}`,
      [...Object.values(record), id],
    );
  } else {
    Object.assign(record, { id, seed_key: seedKey, sort_order: sortOrder });
    await db.query(
      `INSERT INTO instruments (${Object.keys(record).join(",")}) VALUES (${Object.keys(
        record,
      )
        .map((_, i) => `$${i + 1}`)
        .join(",")})`,
      Object.values(record),
    );
  }
  await db.query("DELETE FROM training_entries WHERE instrument_id=$1", [id]);
  for (const name of [...new Set(input.trainedUsers)])
    await db.query(
      "INSERT INTO training_entries(instrument_id,name) VALUES ($1,$2)",
      [id, name],
    );
  await db.query("DELETE FROM sop_links WHERE instrument_id=$1", [id]);
  for (const link of input.sopLinks)
    await db.query(
      "INSERT INTO sop_links(instrument_id,label,url) VALUES ($1,$2,$3)",
      [id, link.label, link.url],
    );
}
export async function seed(db: DB) {
  await db.write(async (tx) => {
    for (const [
      index,
      [name, category, maxTemperatureC, trainedUsers, note],
    ] of initialInstruments.entries()) {
      const key = `initial-${index}`;
      if (
        (await tx.query("SELECT 1 FROM instruments WHERE seed_key=$1", [key]))
          .length
      )
        continue;
      const id = randomUUID();
      await saveInstrument(
        tx,
        {
          name,
          category,
          maxTemperatureC,
          trainedUsers,
          trainingNote: note ?? (trainedUsers.length ? "" : "Not specified"),
          location: "",
          description:
            index === 6 || index === 13
              ? "Initially configured as one shared resource. Administrators can create separate resources if needed."
              : "",
          status: "available",
          priority: index < 7,
          bookingRules: "",
          schedulingMode: "internal",
          coordinatorApproval: false,
          setupMinutes: 0,
          cleanupMinutes: 0,
          trainingPolicy: "",
          sopLinks: [],
          archived: false,
        },
        id,
        false,
        key,
        index,
      );
      await audit(tx, null, "instrument.seeded", id, {
        name,
        note: "Initial configuration; operational state requires lab verification.",
      });
    }
  });
}
export async function exportLocalDatabase(db: DB, destination: string) {
  if (!db.local)
    throw new Error(
      "Use Neon backups/branches or pg_dump for the hosted PostgreSQL database. This command exports only local development data.",
    );
  const blob = await db.local.dumpDataDir("gzip");
  writeFileSync(destination, Buffer.from(await blob.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
}
