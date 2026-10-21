import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../server/app.js";
import { bootstrapAdmin } from "../server/auth.js";
import {
  instruments,
  member,
  openDatabase,
  seed,
  migrate,
  exportLocalDatabase,
  poolOptions,
  type DB,
} from "../server/db.js";
import type { Member } from "../shared/schema.js";

const origin = "http://localhost:5173",
  password = "Test-only-long-passphrase-42!";
let db: DB, app: ReturnType<typeof createApp>, adminId: string;
type Method = "post" | "put" | "patch";
async function client(target = app) {
  const agent = request.agent(target);
  let csrf = (await agent.get("/api/session").expect(200)).body
    .csrfToken as string;
  return {
    agent,
    get csrf() {
      return csrf;
    },
    async write(method: Method, path: string, data: unknown = {}) {
      const result = await agent[method](`/api${path}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data as object);
      if (result.body.csrfToken) csrf = result.body.csrfToken;
      return result;
    },
    async login(email = "admin@example.test") {
      const result = await this.write("post", "/auth/login", {
        email,
        password,
      });
      expect(result.status).toBe(200);
      return result.body.user as Member;
    },
  };
}
async function register(role = "PhD student", extra = {}) {
  const c = await client(),
    email = `${randomUUID()}@example.test`;
  const response = await c.write("post", "/auth/register", {
    email,
    password,
    appRole: "administrator",
    status: "approved",
  });
  expect(response.status).toBe(201);
  const id = response.body.user.id as string;
  const result = await c.write("put", "/onboarding", {
    fullName: "Test Researcher",
    academicRole: role,
    project: "Synthetic test project",
    mentorId: null,
    mentorPending: role === "Intern" || role === "Master’s student",
    ...extra,
  });
  expect(result.status).toBe(200);
  return { c, id, email };
}
async function updateMember(id: string, changes: Record<string, unknown> = {}) {
  const admin = await client();
  await admin.login();
  const user = (await member(db, id))!;
  return admin.write("patch", `/admin/members/${id}`, {
    status: "approved",
    appRole: user.appRole,
    mentorId: user.mentorId,
    mentorPending: user.mentorPending,
    version: user.version,
    reason: "Verified identity through trusted lab channel.",
    ...changes,
  });
}
beforeAll(async () => {
  db = await openDatabase({ localPath: ":memory:" });
  await migrate(db);
}, 20000);
beforeEach(async () => {
  await db.exec(
    "TRUNCATE audit_events,training_entries,sop_links,instruments,sessions,rate_limits,users RESTART IDENTITY CASCADE",
  );
  await seed(db);
  adminId = await bootstrapAdmin(
    db,
    "admin@example.test",
    password,
    "Test Administrator",
  );
  app = createApp(db, { origin, authLimit: 500 });
});
afterAll(async () => {
  await db.close();
});

describe("accounts and authorization", () => {
  it("blocks anonymous and pending records and ignores privilege injection", async () => {
    await request(app).get("/api/instruments").expect(401);
    const { c, id } = await register("Supervisor");
    await c.agent.get("/api/instruments").expect(403);
    await c.agent.get("/api/admin/members").expect(403);
    expect(await member(db, id)).toMatchObject({
      academicRole: "Supervisor",
      appRole: "member",
      status: "pending",
    });
    expect((await updateMember(id)).status).toBe(200);
    await c.agent.get("/api/instruments").expect(200);
    await c.agent.get("/api/admin/members").expect(403);
    expect(
      (await c.write("post", "/instruments", (await instruments(db))[0]))
        .status,
    ).toBe(403);
  });
  it("requires onboarding before approval and validates profile fields", async () => {
    const c = await client(),
      result = await c.write("post", "/auth/register", {
        email: "new@example.test",
        password,
      });
    expect((await updateMember(result.body.user.id)).status).toBe(400);
    expect(
      (
        await c.write("put", "/onboarding", {
          fullName: "A",
          academicRole: "unknown",
        })
      ).status,
    ).toBe(400);
  });
  it("does not grant administrative access to supervisors or mentors", async () => {
    for (const role of ["supervisor", "mentor"]) {
      const { c, id, email } = await register();
      expect((await updateMember(id, { appRole: role })).status).toBe(200);
      await c.agent.get("/api/instruments").expect(401);
      const fresh = await client();
      await fresh.login(email);
      await fresh.agent.get("/api/admin/members").expect(403);
      await fresh.agent.get("/api/admin/audit").expect(403);
      await fresh.agent.get("/api/instruments").expect(200);
    }
  });
  it("restricts bootstrap to one administrator and protects the last active admin", async () => {
    await expect(
      bootstrapAdmin(
        db,
        "second@example.test",
        password,
        "Second Administrator",
      ),
    ).rejects.toThrow("already exists");
    const c = await client();
    await c.login();
    expect((await c.write("post", "/admin/bootstrap")).status).toBe(404);
    expect((await updateMember(adminId, { status: "inactive" })).status).toBe(
      409,
    );
    expect((await updateMember(adminId, { appRole: "member" })).status).toBe(
      409,
    );
    expect((await member(db, adminId))?.status).toBe("approved");
  });
  it("protects the last administrator during simultaneous demotions", async () => {
    const second = await register();
    await updateMember(second.id, { appRole: "administrator" });
    const a = await client(),
      b = await client();
    await a.login();
    await b.login(second.email);
    const first = (await member(db, adminId))!,
      other = (await member(db, second.id))!;
    const payload = (m: Member) => ({
      status: "approved",
      appRole: "member",
      mentorId: null,
      mentorPending: false,
      version: m.version,
      reason: "Synthetic concurrent demotion test",
    });
    const results = await Promise.all([
      a.write("patch", `/admin/members/${adminId}`, payload(first)),
      b.write("patch", `/admin/members/${second.id}`, payload(other)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.query(
        "SELECT count(*)::int AS n FROM users WHERE app_role='administrator' AND status='approved'",
      ),
    ).toEqual([{ n: 1 }]);
  });
  it("revokes departed members while preserving history", async () => {
    const { c, id, email } = await register();
    await updateMember(id);
    await c.agent.get("/api/instruments").expect(200);
    expect((await updateMember(id, { status: "inactive" })).status).toBe(200);
    await c.agent.get("/api/instruments").expect(401);
    expect((await member(db, id))?.status).toBe("inactive");
    expect(
      (await db.query("SELECT 1 FROM audit_events WHERE entity_id=$1", [id]))
        .length,
    ).toBeGreaterThan(0);
    const fresh = await client();
    expect(
      (await fresh.write("post", "/auth/login", { email, password })).status,
    ).toBe(401);
  });
  it("normalizes emails and handles duplicate simultaneous registration", async () => {
    const a = await client(),
      b = await client();
    const results = await Promise.all([
      a.write("post", "/auth/register", {
        email: "Case@EXAMPLE.test",
        password,
      }),
      b.write("post", "/auth/register", {
        email: "case@example.test",
        password,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.query("SELECT count(*)::int AS n FROM users WHERE email=$1", [
        "case@example.test",
      ]),
    ).toEqual([{ n: 1 }]);
  });
});
describe("mentorship", () => {
  it("lists only eligible approved mentors without emails", async () => {
    const mentor = await register("Postdoc"),
      pending = await register("PhD student");
    await updateMember(mentor.id);
    const intern = await register("Intern"),
      list = await intern.c.agent.get("/api/mentors").expect(200);
    expect(list.body.map((m: Member) => m.id)).toEqual([mentor.id]);
    expect(JSON.stringify(list.body)).not.toContain("email");
    expect(
      (
        await intern.c.write("put", "/onboarding", {
          fullName: "Test Intern",
          academicRole: "Intern",
          project: "",
          mentorId: pending.id,
          mentorPending: false,
        })
      ).status,
    ).toBe(400);
    expect((await member(db, intern.id))?.mentorPending).toBe(true);
  });
  it("flags mentees for reassignment when mentors leave", async () => {
    const mentor = await register();
    await updateMember(mentor.id);
    const intern = await register("Intern", {
      mentorId: mentor.id,
      mentorPending: false,
    });
    await updateMember(intern.id);
    expect((await updateMember(mentor.id, { status: "inactive" })).status).toBe(
      200,
    );
    expect(await member(db, intern.id)).toMatchObject({
      mentorId: null,
      mentorPending: true,
      status: "approved",
    });
    expect(
      await db.query(
        "SELECT details FROM audit_events WHERE entity_id=$1 AND action='mentor.reassignment_required'",
        [intern.id],
      ),
    ).toEqual([{ details: JSON.stringify({ previousMentorId: mentor.id }) }]);
  });
});
describe("session security and Vercel persistence", () => {
  it("enforces Origin and CSRF on every mutation", async () => {
    const c = await client();
    await c.agent
      .post("/api/auth/register")
      .send({ email: "x@example.test", password })
      .expect(403);
    await c.agent
      .post("/api/auth/register")
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", c.csrf)
      .send({ email: "x@example.test", password })
      .expect(403);
    await c.agent
      .post("/api/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", "bad")
      .send({ email: "x@example.test", password })
      .expect(403);
    expect(await db.query("SELECT count(*)::int AS n FROM users")).toEqual([
      { n: 1 },
    ]);
  });
  it("hashes passwords, rotates sessions, sets private cookies, and denies caching", async () => {
    const c = await client(),
      before = c.csrf;
    await c.login();
    expect(c.csrf).not.toBe(before);
    const response = await c.agent.get("/api/session");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.body)).not.toContain("password");
    const [row] = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [adminId],
    );
    expect(row.password_hash.startsWith("scrypt:")).toBe(true);
    expect(row.password_hash).not.toContain(password);
    const logout = await c.write("post", "/logout");
    expect(logout.headers["clear-site-data"]).toContain("storage");
    expect(logout.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(logout.headers["set-cookie"][0]).toContain("SameSite=Strict");
    await c.agent.get("/api/instruments").expect(401);
  });
  it("sets Secure cookies and security headers in production", async () => {
    const response = await request(
      createApp(db, { origin: "https://lab.example.test", production: true }),
    ).get("/api/session");
    expect(response.headers["set-cookie"][0]).toContain("Secure");
    expect(response.headers["strict-transport-security"]).toBeTruthy();
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });
  it("revokes other sessions on password change and expires sessions", async () => {
    const c = await client(),
      other = await client();
    await c.login();
    await other.login();
    expect(
      (
        await c.write("post", "/password", {
          currentPassword: password,
          newPassword: "Replacement-test-passphrase-43!",
        })
      ).status,
    ).toBe(200);
    await other.agent.get("/api/instruments").expect(401);
    await c.agent.get("/api/instruments").expect(200);
    const fresh = await client();
    expect(
      (
        await fresh.write("post", "/auth/login", {
          email: "admin@example.test",
          password,
        })
      ).status,
    ).toBe(401);
    await db.query("UPDATE sessions SET expires_at=0");
    await c.agent.get("/api/instruments").expect(401);
  });
  it("shares authentication throttling between app instances", async () => {
    const a = await client(createApp(db, { origin, authLimit: 2 })),
      b = await client(createApp(db, { origin, authLimit: 2 }));
    expect(
      (
        await a.write("post", "/auth/login", {
          email: "unknown@example.test",
          password,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await b.write("post", "/auth/login", {
          email: "unknown@example.test",
          password,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await a.write("post", "/auth/login", {
          email: "unknown@example.test",
          password,
        })
      ).status,
    ).toBe(429);
  });
  it("accepts a stored session on a new app instance", async () => {
    const c = await client();
    const login = await c.write("post", "/auth/login", {
      email: "admin@example.test",
      password,
    });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const otherInstance = createApp(db, { origin });
    await request(otherInstance)
      .get("/api/instruments")
      .set("Cookie", cookie)
      .expect(200);
    expect((await c.write("post", "/logout")).status).toBe(200);
    await request(otherInstance)
      .get("/api/instruments")
      .set("Cookie", cookie)
      .expect(401);
  });
  it("refuses ephemeral Vercel/production storage and verifies hosted TLS", async () => {
    await expect(openDatabase({ vercel: true })).rejects.toThrow(
      "DATABASE_URL",
    );
    await expect(openDatabase({ production: true })).rejects.toThrow(
      "DATABASE_URL",
    );
    const settings = poolOptions(
      "postgresql://user:synthetic@db.example.test/lab?sslmode=require",
    );
    expect(settings.ssl.rejectUnauthorized).toBe(true);
    expect(settings.connectionString).not.toContain("sslmode");
    expect(settings.max).toBe(3);
  });
});
describe("instrument configuration and PostgreSQL durability", () => {
  it("seeds all 15 instruments, exact limits, and distinct training names without accounts", async () => {
    const list = await instruments(db);
    expect(list).toHaveLength(15);
    expect(list.filter((i) => i.priority)).toHaveLength(7);
    expect(
      list
        .filter((i) => i.category === "Furnace")
        .map((i) => i.maxTemperatureC),
    ).toEqual([1050, 1050, 1200, 1400]);
    expect(list.find((i) => i.name === "SQUID")?.trainedUsers).toEqual([
      "Akhil N",
    ]);
    expect(list.find((i) => i.name === "BET")?.trainedUsers).toEqual([
      "Akhila",
    ]);
    expect(list.find((i) => i.name.startsWith("P-XRD"))?.name).toContain(
      "Brooker XRD",
    );
    expect(await db.query("SELECT count(*)::int AS n FROM users")).toEqual([
      { n: 1 },
    ]);
  });
  it("does not overwrite edited configuration when seeding again", async () => {
    const c = await client();
    await c.login();
    const i = (await instruments(db))[0];
    expect(
      (
        await c.write("put", `/instruments/${i.id}`, {
          ...i,
          location: "Test room",
          trainedUsers: ["Directory Only"],
          sopLinks: [
            { label: "Test SOP", url: "https://lab.example.test/private/sop" },
          ],
        })
      ).status,
    ).toBe(200);
    await seed(db);
    await migrate(db);
    expect(await instruments(db)).toHaveLength(15);
    expect((await instruments(db)).find((x) => x.id === i.id)).toMatchObject({
      location: "Test room",
      trainedUsers: ["Directory Only"],
      version: 2,
    });
  });
  it("archives history and can create a separate resource", async () => {
    const c = await client();
    await c.login();
    const original = (await instruments(db))[6];
    expect(
      (
        await c.write("put", `/instruments/${original.id}`, {
          ...original,
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect(await instruments(db)).toHaveLength(14);
    expect(
      (
        await c.write("post", "/instruments", {
          ...original,
          name: "Separate RF system",
          archived: false,
        })
      ).status,
    ).toBe(201);
    expect(await instruments(db, true)).toHaveLength(16);
    expect(
      (await instruments(db, true)).find((i) => i.id === original.id)?.archived,
    ).toBe(true);
  });
  it("rejects simultaneous stale instrument edits with atomic audit history", async () => {
    const c = await client();
    await c.login();
    const i = (await instruments(db))[0];
    const results = await Promise.all([
      c.write("put", `/instruments/${i.id}`, { ...i, location: "Room A" }),
      c.write("put", `/instruments/${i.id}`, { ...i, location: "Room B" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='instrument.updated'",
        [i.id],
      ),
    ).toEqual([{ n: 1 }]);
  });
  it("validates limits, buffers, statuses, and unsafe SOP links", async () => {
    const c = await client();
    await c.login();
    const i = (await instruments(db))[0];
    for (const fields of [
      { maxTemperatureC: -1 },
      { setupMinutes: -10 },
      { sopLinks: [{ label: "Unsafe", url: "javascript:alert(1)" }] },
      { status: "running automatically" },
    ])
      expect(
        (await c.write("put", `/instruments/${i.id}`, { ...i, ...fields }))
          .status,
      ).toBe(400);
    expect((await instruments(db))[0].version).toBe(1);
  });
  it("enforces foreign keys and append-only audit history", async () => {
    await expect(
      db.query("UPDATE users SET mentor_id='missing' WHERE id=$1", [adminId]),
    ).rejects.toThrow();
    await expect(db.query("DELETE FROM audit_events")).rejects.toThrow(
      "append only",
    );
    await expect(
      db.query("UPDATE audit_events SET details='{}'"),
    ).rejects.toThrow("append only");
  });
  it("persists local PostgreSQL data across close/reopen and restores a local export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quemat-pg-persistence-"));
    let local = await openDatabase({ localPath: join(dir, "postgres") });
    try {
      await expect(
        openDatabase({ localPath: join(dir, "postgres") }),
      ).rejects.toThrow("in use");
      await migrate(local);
      await seed(local);
      await local.query(
        "UPDATE instruments SET location='Retained room' WHERE seed_key='initial-0'",
      );
      await local.close();
      local = await openDatabase({ localPath: join(dir, "postgres") });
      expect((await instruments(local))[0].location).toBe("Retained room");
      const target = join(dir, "backup.tar.gz");
      await exportLocalDatabase(local, target);
      const restored = await PGlite.create({
        loadDataDir: new Blob([readFileSync(target)]),
      });
      try {
        expect(
          (await restored.query("SELECT count(*)::int AS n FROM instruments"))
            .rows,
        ).toEqual([{ n: 15 }]);
      } finally {
        await restored.close();
      }
    } finally {
      await local.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
