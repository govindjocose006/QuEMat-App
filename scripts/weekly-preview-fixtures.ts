import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../server/auth.js";
import type { DB } from "../server/db.js";

// Called only after preview-db.ts verifies the explicit target and stored identity.
export async function weeklyPreviewFixtures(db: DB, path: string) {
  if (
    (
      await db.query(
        "SELECT id FROM users WHERE email NOT LIKE '%@example.test'",
      )
    ).length
  )
    throw new Error(
      "Weekly fixtures require an entirely synthetic preview database.",
    );
  if (
    !(
      await db.query(
        "SELECT 1 FROM schema_migrations WHERE name='003_weekly_progress.sql'",
      )
    ).length
  )
    throw new Error("Apply the preview-only Phase 3A migration first.");
  const definitions = [
    {
      key: "mentor",
      name: "Weekly Preview Mentor",
      role: "mentor",
      academic: "PhD student",
    },
    {
      key: "member",
      name: "Weekly Preview Mentee",
      role: "member",
      academic: "Intern",
    },
    {
      key: "supervisor",
      name: "Weekly Preview Supervisor",
      role: "supervisor",
      academic: "Supervisor",
    },
    {
      key: "other",
      name: "Weekly Preview Other",
      role: "member",
      academic: "PhD student",
    },
  ];
  const accounts: Record<string, { email: string; password: string }> =
    existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : Object.fromEntries(
          definitions.map((d) => [
            d.key,
            {
              email: `weekly-preview-${d.key}@example.test`,
              password: randomBytes(30).toString("base64url"),
            },
          ]),
        );
  for (const d of definitions)
    if (
      accounts[d.key]?.email !== `weekly-preview-${d.key}@example.test` ||
      typeof accounts[d.key]?.password !== "string" ||
      accounts[d.key].password.length < 24
    )
      throw new Error("Invalid private weekly preview account file.");
  if (!existsSync(path))
    writeFileSync(path, JSON.stringify(accounts, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  const hashes = Object.fromEntries(
    await Promise.all(
      definitions.map(async (d) => [
        d.key,
        await hashPassword(accounts[d.key].password),
      ]),
    ),
  );
  await db.write(async (tx) => {
    // Repeat the synthetic-data guard inside the transaction before any writes.
    if (
      (
        await tx.query(
          "SELECT id FROM users WHERE email NOT LIKE '%@example.test'",
        )
      ).length
    )
      throw new Error("Non-synthetic account detected; no fixtures applied.");
    const ids: Record<string, string> = {};
    for (const d of definitions) {
      const [existing] = await tx.query<{
        id: string;
        app_role: string;
        academic_role: string;
        status: string;
        mentor_id: string | null;
      }>(
        "SELECT id,app_role,academic_role,status,mentor_id FROM users WHERE email=$1",
        [accounts[d.key].email],
      );
      if (existing) {
        if (
          existing.app_role !== d.role ||
          existing.academic_role !== d.academic ||
          existing.status !== "approved" ||
          (d.key === "member" && existing.mentor_id !== ids.mentor)
        )
          throw new Error(
            "Existing weekly fixture membership changed; review it privately instead of overwriting it.",
          );
        ids[d.key] = existing.id;
        continue;
      }
      ids[d.key] = randomUUID();
      await tx.query(
        "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,academic_role,project,mentor_id,created_at) VALUES($1,$2,$3,$4,$5,'approved',1,$6,'Synthetic weekly preview',$7,now())",
        [
          ids[d.key],
          accounts[d.key].email,
          hashes[d.key],
          d.name,
          d.role,
          d.academic,
          d.key === "member" ? ids.mentor : null,
        ],
      );
    }
    await tx.query(
      "INSERT INTO samples(id,owner_id,compound,project,batch,origin,notes) SELECT $1,$2,'FeSe — Phase 3A synthetic','Synthetic weekly preview','Phase 3A preview','internal','Synthetic record; no physical sample' WHERE NOT EXISTS(SELECT 1 FROM samples WHERE owner_id=$2 AND batch='Phase 3A preview')",
      [randomUUID(), ids.member],
    );
  });
}
