import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DB } from "../server/db.js";

const state = vi.hoisted(() => ({ db: undefined as DB | undefined }));
vi.mock("../server/db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db.js")>()),
  openDatabase: async () => {
    if (!state.db) throw new Error("No isolated test database");
    return state.db;
  },
}));
let db: DB, directory: string, file: string;
beforeEach(async () => {
  const original =
    await vi.importActual<typeof import("../server/db.js")>("../server/db.js");
  db = await original.openDatabase({ localPath: ":memory:" });
  state.db = {
    ...db,
    query: async (query, values) =>
      query.startsWith("SELECT current_database()")
        ? ([{ name: "quemat_pr1_preview", role: "synthetic" }] as never)
        : db.query(query, values),
    close: async () => {},
  };
  directory = mkdtempSync(join(tmpdir(), "quemat-preview-data-"));
  file = join(directory, ".env.preview");
  writeFileSync(
    file,
    [
      "PREVIEW_ONLY=quemat-pr1-synthetic",
      "PREVIEW_NEON_PROJECT_ID=synthetic-preview-123",
      "PREVIEW_NEON_BRANCH_ID=br-test-preview",
      "PREVIEW_NEON_HOST=ep-test-preview.ap-southeast-1.aws.neon.tech",
      "DATABASE_URL=postgresql://synthetic:test@ep-test-preview-pooler.ap-southeast-1.aws.neon.tech/quemat_pr1_preview",
      "DATABASE_URL_UNPOOLED=postgresql://synthetic:test@ep-test-preview.ap-southeast-1.aws.neon.tech/quemat_pr1_preview",
    ].join("\n"),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}, 20000);
afterEach(async () => {
  state.db = undefined;
  await db.close();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function run(action: string) {
  const argv = process.argv,
    exitCode = process.exitCode;
  vi.resetModules();
  process.argv = [process.execPath, "scripts/preview-db.ts", file, action];
  process.exitCode = undefined;
  try {
    await import("../scripts/preview-db.js");
    return process.exitCode;
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
}
it("initializes an empty isolated database and repeatable synthetic fixtures without printing passwords", async () => {
  expect(await run("prepare")).toBeUndefined();
  expect(await run("fixtures")).toBeUndefined();
  const accounts = JSON.parse(
    readFileSync(join(directory, ".env.preview-accounts.json"), "utf8"),
  );
  expect(Object.keys(accounts)).toHaveLength(4);
  expect(
    new Set(
      Object.values(accounts).map(
        (a: unknown) => (a as { password: string }).password,
      ),
    ).size,
  ).toBe(4);
  expect(await run("fixtures")).toBeUndefined();
  expect((await db.query("SELECT id FROM users")).length).toBe(4);
  expect((await db.query("SELECT id FROM samples")).length).toBe(2);
  expect((await db.query("SELECT id FROM instruments")).length).toBe(15);
  expect((await db.query("SELECT name FROM schema_migrations")).length).toBe(6);
  expect(
    (
      await db.query(
        "SELECT id FROM users WHERE app_role='administrator' AND status='approved'",
      )
    ).length,
  ).toBe(1);
  const logs = JSON.stringify(vi.mocked(console.log).mock.calls);
  for (const account of Object.values(accounts) as { password: string }[])
    expect(logs).not.toContain(account.password);
}, 20000);
it("refuses an unmarked nonempty database before migration or fixture writes", async () => {
  await db.exec(
    "CREATE TABLE must_not_touch(id INTEGER PRIMARY KEY);INSERT INTO must_not_touch VALUES(7)",
  );
  expect(await run("prepare")).toBe(1);
  expect(await db.query("SELECT id FROM must_not_touch")).toEqual([{ id: 7 }]);
  expect(
    (
      await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
      )
    ).length,
  ).toBe(1);
});
it("adds repeatable weekly synthetic roles and mentor relationships without overwriting existing accounts", async () => {
  await run("prepare");
  await run("fixtures");
  const before = await db.query("SELECT * FROM users ORDER BY id");
  expect(await run("weekly-fixtures")).toBeUndefined();
  expect(await run("weekly-fixtures")).toBeUndefined();
  expect((await db.query("SELECT id FROM users")).length).toBe(8);
  expect(
    await db.query(
      "SELECT * FROM users WHERE email NOT LIKE 'weekly-preview-%' ORDER BY id",
    ),
  ).toEqual(before);
  const [mentee] = await db.query<{ mentor_id: string }>(
    "SELECT mentor_id FROM users WHERE email='weekly-preview-member@example.test'",
  );
  expect(
    (
      await db.query("SELECT id FROM users WHERE id=$1 AND app_role='mentor'", [
        mentee.mentor_id,
      ])
    ).length,
  ).toBe(1);
  const secrets = JSON.parse(
    readFileSync(join(directory, ".env.weekly-accounts.json"), "utf8"),
  );
  for (const value of Object.values(secrets) as { password: string }[])
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      value.password,
    );
  await db.query(
    "UPDATE users SET app_role='member' WHERE email='weekly-preview-mentor@example.test'",
  );
  expect(await run("weekly-fixtures")).toBe(1);
}, 20000);
it("refuses fixtures when the stored preview identity does not match", async () => {
  expect(await run("prepare")).toBeUndefined();
  await db.query(
    "UPDATE quemat_preview_identity SET project_id='another-preview'",
  );
  expect(await run("fixtures")).toBe(1);
  expect((await db.query("SELECT id FROM users")).length).toBe(0);
});
it("refuses prepare before migrations/seeding when a marked preview contains a non-synthetic account", async () => {
  await run("prepare");
  await run("fixtures");
  await db.query(
    "UPDATE users SET email='real-person@outside.invalid' WHERE email='preview-member@example.test'",
  );
  const tables = ["users", "instruments", "samples", "schema_migrations"];
  const before = await Promise.all(
    tables.map((t) => db.query(`SELECT * FROM ${t} ORDER BY 1`)),
  );
  expect(await run("prepare")).toBe(1);
  expect(
    await Promise.all(
      tables.map((t) => db.query(`SELECT * FROM ${t} ORDER BY 1`)),
    ),
  ).toEqual(before);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
    "non-synthetic",
  );
}, 20000);

it("adds repeatable meeting/notice fixtures without changing synthetic accounts or running production paths", async () => {
  await run("prepare");
  await run("fixtures");
  await run("weekly-fixtures");
  const accounts = await db.query("SELECT * FROM users ORDER BY id");
  expect(await run("meetings-fixtures")).toBeUndefined();
  expect(await run("meetings-fixtures")).toBeUndefined();
  expect(await db.query("SELECT * FROM users ORDER BY id")).toEqual(accounts);
  expect(await db.query("SELECT id FROM meetings")).toHaveLength(1);
  expect(await db.query("SELECT id FROM notices")).toHaveLength(1);
  expect(
    await db.query("SELECT notice_id FROM notice_acknowledgements"),
  ).toHaveLength(0);
  expect(await db.query("SELECT id FROM meeting_events")).toHaveLength(1);
  expect(await db.query("SELECT id FROM notice_events")).toHaveLength(1);
  const member = (
    await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email='weekly-preview-member@example.test'",
    )
  )[0];
  expect(
    await db.query(
      "SELECT meeting_id FROM meeting_attendees WHERE user_id=$1",
      [member.id],
    ),
  ).toHaveLength(1);
}, 20000);
