import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.js";
import { openDatabase, migrate, seed, type DB } from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import { phase3aFixture } from "./phase3b-release-fixture.js";
import {
  meetingCalendar,
  meetingFields,
  meetingSchema,
  noticeFields,
  noticeSchema,
  type MeetingDetail,
  type NoticeDetail,
} from "../shared/meetings.js";
const origin = "http://localhost:5173",
  password = "Meetings-synthetic-only-passphrase!";
let db: DB, app: ReturnType<typeof createApp>, ids: Record<string, string>;
async function client(key = "member") {
  const agent = request.agent(app);
  let csrf = (await agent.get("/api/session")).body.csrfToken;
  const c = {
    get: (path: string) => agent.get("/api" + path),
    write: async (
      path: string,
      data: object = {},
      method: "post" | "put" = "post",
    ) => {
      const r = await agent[method]("/api" + path)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data);
      if (r.body.csrfToken) csrf = r.body.csrfToken;
      return r;
    },
  };
  expect(
    (await c.write("/auth/login", { email: `${key}@example.test`, password }))
      .status,
  ).toBe(key === "inactive" ? 401 : 200);
  return c;
}
type Client = Awaited<ReturnType<typeof client>>;
function input(extra: Record<string, unknown> = {}) {
  return meetingSchema.parse({
    title: "Synthetic private meeting",
    kind: "individual",
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    attendeeIds: [ids.member],
    agenda: "Confidential synthetic agenda",
    venue: "Synthetic lab",
    videoUrl: "https://example.test/private-room",
    dataLinks: [
      { label: "Synthetic record", url: "https://example.test/private-data" },
    ],
    ...extra,
  });
}
async function meeting(c: Client, extra: Record<string, unknown> = {}) {
  const r = await c.write("/meetings", input(extra));
  expect(r.status, r.body.error).toBe(201);
  return r.body as MeetingDetail;
}
async function notice(c: Client, extra: Record<string, unknown> = {}) {
  const r = await c.write(
    "/notices",
    noticeSchema.parse({
      title: "Synthetic pinned notice",
      body: "Read the updated synthetic notes. This is not an approval request.",
      pinned: true,
      acknowledgementRequired: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      ...extra,
    }),
  );
  expect(r.status, r.body.error).toBe(201);
  return r.body as NoticeDetail;
}
async function publish(c: Client, n: NoticeDetail) {
  const r = await c.write(`/notices/${n.id}/publish`, { version: n.version });
  expect(r.status, r.body.error).toBe(200);
  return r.body as NoticeDetail;
}
function update(m: MeetingDetail, extra: Record<string, unknown> = {}) {
  return { ...meetingFields.parse(m), version: m.version, ...extra };
}
function noticeEdit(n: NoticeDetail, extra: Record<string, unknown> = {}) {
  return { ...noticeFields.parse(n), version: n.version, ...extra };
}
beforeAll(async () => {
  db = await openDatabase({ localPath: ":memory:" });
  await migrate(db);
}, 20000);
beforeEach(async () => {
  await db.exec(
    "TRUNCATE users,instruments,audit_events,rate_limits RESTART IDENTITY CASCADE",
  );
  await seed(db);
  ids = {
    admin: await bootstrapAdmin(
      db,
      "admin@example.test",
      password,
      "Synthetic administrator",
    ),
  };
  const [admin] = await db.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=$1",
    [ids.admin],
  );
  for (const [key, role, status, academic] of [
    ["member", "member", "approved", "PhD student"],
    ["other", "member", "approved", "PhD student"],
    ["academic", "member", "approved", "Supervisor"],
    ["mentor", "mentor", "approved", "Postdoc"],
    ["supervisor", "supervisor", "approved", "Supervisor"],
    ["pending", "member", "pending", "PhD student"],
    ["inactive", "member", "inactive", "PhD student"],
  ]) {
    ids[key] = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,academic_role,created_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,now())",
      [
        ids[key],
        `${key}@example.test`,
        admin.password_hash,
        `Synthetic ${key}`,
        role,
        status,
        academic,
      ],
    );
  }
  app = createApp(db, { origin, authLimit: 1000 });
});
afterAll(() => db.close());
it("requires approved active onboarding for lists, summaries, details and calendar export", async () => {
  const a = await client("admin"),
    m = await meeting(a),
    n = await publish(a, await notice(a));
  const paths = [
    "/meetings",
    "/meetings/options",
    "/collaboration/summary",
    "/notices",
    `/meetings/${m.id}`,
    `/meetings/${m.id}/calendar`,
    `/notices/${n.id}`,
  ];
  for (const path of paths)
    expect((await request(app).get("/api" + path)).status).toBe(401);
  for (const key of ["pending", "inactive"]) {
    const c = await client(key);
    for (const path of paths)
      expect([401, 403]).toContain((await c.get(path)).status);
  }
  await db.query("UPDATE users SET status='pending',onboarded=0 WHERE id=$1", [
    ids.member,
  ]);
  const c = await client();
  for (const path of paths) expect((await c.get(path)).status).toBe(403);
});
it("restricts meeting and notice management to application roles, never academic or mentor roles", async () => {
  for (const key of ["member", "academic", "mentor"]) {
    const c = await client(key);
    expect((await c.write("/meetings", input())).status).toBe(403);
    expect(
      (
        await c.write("/notices", {
          title: "Forbidden notice",
          body: "Not allowed",
        })
      ).status,
    ).toBe(403);
  }
  expect((await meeting(await client("supervisor"))).createdBy).toBe(
    ids.supervisor,
  );
});
it("scopes group and individual meeting lists, history, notes, action items, summary and ICS to current attendees/managers", async () => {
  const a = await client("supervisor"),
    c = await client(),
    other = await client("other");
  for (const kind of ["individual", "group"]) {
    const m = await meeting(a, { kind });
    await c.write(`/meetings/${m.id}/notes`, {
      body: "Private synthetic notes",
    });
    for (const path of [`/meetings/${m.id}`, `/meetings/${m.id}/calendar`])
      expect((await other.get(path)).status).toBe(404);
    expect(
      (await other.write(`/meetings/${m.id}/notes`, { body: "Forbidden" }))
        .status,
    ).toBe(404);
    expect((await other.get("/meetings?view=all")).body.items).toHaveLength(0);
    expect(
      (await other.get("/collaboration/summary")).body.meetings,
    ).toHaveLength(0);
    expect((await c.get(`/meetings/${m.id}`)).body.notes[0].body).toBe(
      "Private synthetic notes",
    );
    expect((await c.get(`/meetings/${m.id}/calendar`)).status).toBe(200);
    expect(
      (await (await client("admin")).get(`/meetings/${m.id}`)).status,
    ).toBe(200);
  }
});
it("retains reschedule and cancellation snapshots, actors and original identity with optimistic concurrency", async () => {
  const a = await client("admin"),
    c = await client();
  let m = await meeting(a),
    original = m;
  const body = update(m, {
    startsAt: new Date(Date.now() + 10800000).toISOString(),
    endsAt: new Date(Date.now() + 14400000).toISOString(),
    reason: "Synthetic reschedule",
  });
  const races = await Promise.all([
    a.write(`/meetings/${m.id}`, body, "put"),
    a.write(`/meetings/${m.id}`, body, "put"),
  ]);
  expect(races.map((r) => r.status).sort()).toEqual([200, 409]);
  m = races.find((r) => r.status === 200)!.body;
  expect(m.events).toHaveLength(2);
  expect(m.events[1].before!.startsAt).toBe(original.startsAt);
  expect(m.events[1].reason).toBe("Synthetic reschedule");
  expect(
    (await c.write(`/meetings/${m.id}/cancel`, { version: m.version })).status,
  ).toBe(403);
  const cancel = await a.write(`/meetings/${m.id}/cancel`, {
    version: m.version,
    reason: "Synthetic cancellation",
  });
  expect(cancel.status).toBe(200);
  m = cancel.body;
  expect(m.status).toBe("cancelled");
  expect(m.events.map((e) => e.kind)).toEqual([
    "created",
    "updated",
    "cancelled",
  ]);
  expect(m.createdAt).toBe(original.createdAt);
  expect((await c.get("/meetings")).body.items).toHaveLength(0);
  expect((await c.get("/meetings?view=cancelled")).body.items[0].id).toBe(m.id);
  expect((await a.write(`/meetings/${m.id}`, update(m), "put")).status).toBe(
    409,
  );
  expect((await c.get(`/meetings/${m.id}/calendar`)).text).toContain(
    "STATUS:CANCELLED",
  );
});
it("revokes removed participant access immediately, including previous notes, exports and notification links", async () => {
  const a = await client("admin"),
    c = await client(),
    other = await client("other");
  let m = await meeting(a);
  await c.write(`/meetings/${m.id}/notes`, { body: "Retained private note" });
  const privateNotification = (
    await c.get("/notifications/page")
  ).body.items.find((n: { meetingId: string }) => n.meetingId === m.id);
  expect(privateNotification).toBeTruthy();
  expect(
    (await c.get("/notifications/summary")).body.unreadCount,
  ).toBeGreaterThan(0);
  expect(
    (await c.get("/notifications")).body.some(
      (n: { meetingId: string }) => n.meetingId === m.id,
    ),
  ).toBe(true);
  const r = await a.write(
    `/meetings/${m.id}`,
    update(m, { attendeeIds: [ids.other] }),
    "put",
  );
  expect(r.status, r.body.error).toBe(200);
  m = r.body;
  expect(
    (await c.get("/notifications/page")).body.items.some(
      (n: { meetingId: string }) => n.meetingId === m.id,
    ),
  ).toBe(false);
  expect((await c.get("/notifications/summary")).body.unreadCount).toBe(0);
  expect(
    (await c.write(`/notifications/${privateNotification.id}/read`)).status,
  ).toBe(404);
  expect((await c.get(`/meetings/${m.id}`)).status).toBe(404);
  expect((await c.get(`/meetings/${m.id}/calendar`)).status).toBe(404);
  expect(
    (await c.get("/notifications")).body.some(
      (n: { meetingId: string }) => n.meetingId === m.id,
    ),
  ).toBe(false);
  expect((await other.get(`/meetings/${m.id}`)).body.notes[0].body).toBe(
    "Retained private note",
  );
  const events = await db.query<{ details: string }>(
    "SELECT details FROM audit_events WHERE action LIKE 'meeting.%'",
  );
  expect(JSON.stringify(events)).not.toContain("Retained private note");
  expect(JSON.stringify(events)).not.toContain("Confidential synthetic agenda");
});
it("keeps notes immutable and actions owner-controlled with due dates, completion/reopening and historical actors", async () => {
  const a = await client("admin"),
    c = await client(),
    other = await client("other");
  let m = await meeting(a, { attendeeIds: [ids.member, ids.other] });
  let r = await c.write(`/meetings/${m.id}/notes`, {
    body: "Synthetic note",
    dataLinks: [{ label: "Data", url: "https://example.test/data" }],
  });
  expect(r.status).toBe(201);
  m = r.body;
  expect(
    (
      await c.write(`/meetings/${m.id}/actions`, {
        title: "Forbidden action",
        ownerId: ids.member,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await a.write(`/meetings/${m.id}/actions`, {
        title: "Wrong owner",
        ownerId: ids.academic,
      })
    ).status,
  ).toBe(400);
  r = await a.write(`/meetings/${m.id}/actions`, {
    title: "Prepare synthetic notes",
    ownerId: ids.member,
    dueDate: "2026-11-02",
  });
  expect(r.status, r.body.error).toBe(201);
  m = r.body;
  let action = m.actions[0];
  expect(action.dueDate).toBe("2026-11-02");
  expect(
    (
      await other.write(`/meetings/${m.id}/actions/${action.id}`, {
        version: action.version,
        status: "done",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await a.write(
        `/meetings/${m.id}`,
        update(m, { attendeeIds: [ids.other] }),
        "put",
      )
    ).status,
  ).toBe(400);
  const races = await Promise.all([
    c.write(`/meetings/${m.id}/actions/${action.id}`, {
      version: action.version,
      status: "done",
    }),
    c.write(`/meetings/${m.id}/actions/${action.id}`, {
      version: action.version,
      status: "done",
    }),
  ]);
  expect(races.map((x) => x.status).sort()).toEqual([200, 409]);
  action = races.find((x) => x.status === 200)!.body.actions[0];
  expect(action.completedBy).toBe(ids.member);
  expect(action.completedAt).toBeTruthy();
  expect(action.events).toHaveLength(2);
  r = await a.write(`/meetings/${m.id}/actions/${action.id}`, {
    version: action.version,
    status: "open",
  });
  expect(r.status).toBe(200);
  expect(r.body.actions[0].completedAt).toBe(null);
  expect(
    r.body.actions[0].events.map((e: { status: string }) => e.status),
  ).toEqual(["open", "done", "open"]);
  expect((await c.get("/collaboration/summary")).body.actions[0].id).toBe(
    action.id,
  );
  await expect(
    db.query("UPDATE meeting_notes SET body='tamper' WHERE id=$1", [
      m.notes[0].id,
    ]),
  ).rejects.toThrow(/append only/);
  await expect(
    db.query("DELETE FROM meeting_action_events WHERE action_id=$1", [
      action.id,
    ]),
  ).rejects.toThrow(/append only/);
});
it("does not reopen work for an owner who lost meeting access or active membership", async () => {
  const a = await client("admin");
  let m = await meeting(a, { attendeeIds: [ids.member, ids.other] });
  let r = await a.write(`/meetings/${m.id}/actions`, {
    title: "Synthetic retained completed action",
    ownerId: ids.member,
  });
  const id = r.body.actions[0].id;
  r = await a.write(`/meetings/${m.id}/actions/${id}`, {
    version: 1,
    status: "done",
  });
  expect(r.status).toBe(200);
  r = await a.write(
    `/meetings/${m.id}`,
    update(m, { attendeeIds: [ids.other] }),
    "put",
  );
  expect(r.status, r.body.error).toBe(200);
  m = r.body;
  expect(
    (
      await a.write(`/meetings/${m.id}/actions/${id}`, {
        version: 2,
        status: "open",
      })
    ).status,
  ).toBe(400);
  r = await a.write(
    `/meetings/${m.id}`,
    update(m, { attendeeIds: [ids.member, ids.other] }),
    "put",
  );
  expect(r.status).toBe(200);
  await db.query("UPDATE users SET status='inactive' WHERE id=$1", [
    ids.member,
  ]);
  expect(
    (
      await a.write(`/meetings/${m.id}/actions/${id}`, {
        version: 2,
        status: "open",
      })
    ).status,
  ).toBe(400);
  const retained = (await a.get(`/meetings/${m.id}`)).body.actions[0];
  expect(retained.status).toBe("done");
  expect(retained.version).toBe(2);
  expect(retained.events).toHaveLength(2);
});
it("validates attendees, time ordering and links without changing existing identity or granting privileges", async () => {
  const a = await client("admin");
  for (const extra of [
    { attendeeIds: [] },
    { attendeeIds: [ids.member, ids.member] },
    { attendeeIds: [ids.pending] },
    { attendeeIds: [randomUUID()] },
    { endsAt: new Date(Date.now() - 1000).toISOString() },
    { videoUrl: "javascript:alert(1)" },
    { videoUrl: "https://user:secret@example.test" },
  ]) {
    const result = await a.write("/meetings", { ...input(), ...extra });
    expect(result.status, JSON.stringify(extra)).toBe(400);
  }
  const m = await meeting(a);
  await expect(
    db.query("UPDATE meetings SET created_by=$2 WHERE id=$1", [
      m.id,
      ids.member,
    ]),
  ).rejects.toThrow(/immutable/);
  await expect(
    db.query("DELETE FROM meetings WHERE id=$1", [m.id]),
  ).rejects.toThrow(/retained/);
  await db.query("UPDATE users SET app_role='member' WHERE id=$1", [ids.admin]);
  expect(
    (await a.write(`/meetings/${m.id}/cancel`, { version: m.version })).status,
  ).toBe(403);
});
it("keeps notice drafts private, publishes explicitly, preserves revisions and never exposes unpublished draft history", async () => {
  const a = await client("supervisor"),
    c = await client();
  let n = await notice(a, { body: "Private draft wording" });
  expect((await c.get(`/notices/${n.id}`)).status).toBe(404);
  expect((await c.get("/notices?view=all")).body.items).toHaveLength(0);
  expect((await c.get("/notices?view=drafts")).status).toBe(403);
  expect((await c.get("/notifications")).body).toHaveLength(0);
  let r = await a.write(
    `/notices/${n.id}`,
    noticeEdit(n, { body: "Published wording" }),
    "put",
  );
  expect(r.status).toBe(200);
  n = await publish(a, r.body);
  let fresh = (await c.get(`/notices/${n.id}`)).body as NoticeDetail;
  expect(fresh.body).toBe("Published wording");
  expect(JSON.stringify(fresh)).not.toContain("Private draft wording");
  expect(fresh.events).toHaveLength(1);
  const first = n.publishedAt;
  r = await a.write(
    `/notices/${n.id}`,
    noticeEdit(n, { body: "Corrected public wording" }),
    "put",
  );
  expect(r.status).toBe(200);
  n = r.body;
  fresh = (await c.get(`/notices/${n.id}`)).body;
  expect(fresh.events).toHaveLength(2);
  expect(fresh.publishedAt).toBe(first);
  expect(fresh.events[0].after.body).toBe("Published wording");
  expect((await c.get("/collaboration/summary")).body.notices[0].id).toBe(n.id);
});
it("records explicit per-revision read acknowledgement idempotently and separately from opening or inbox reads", async () => {
  const a = await client("admin"),
    c = await client(),
    other = await client("other");
  let n = await publish(a, await notice(a));
  expect((await c.get(`/notices/${n.id}`)).body.acknowledged).toBe(false);
  const inbox = (await c.get("/notifications")).body;
  const notification = inbox.find(
    (x: { noticeId: string }) => x.noticeId === n.id,
  );
  await c.write(`/notifications/${notification.id}/read`);
  expect((await c.get(`/notices/${n.id}`)).body.acknowledged).toBe(false);
  for (const confirmedRead of [false, undefined, "true"])
    expect(
      (
        await c.write(`/notices/${n.id}/acknowledge`, {
          version: n.version,
          confirmedRead,
        })
      ).status,
    ).toBe(400);
  const body = { version: n.version, confirmedRead: true };
  const races = await Promise.all([
    c.write(`/notices/${n.id}/acknowledge`, body),
    c.write(`/notices/${n.id}/acknowledge`, body),
  ]);
  expect(races.map((r) => r.status)).toEqual([200, 200]);
  expect(
    (
      await db.query(
        "SELECT * FROM notice_acknowledgements WHERE notice_id=$1",
        [n.id],
      )
    ).length,
  ).toBe(1);
  expect(
    (await other.get(`/notices/${n.id}`)).body.acknowledgements,
  ).toHaveLength(0);
  expect((await a.get(`/notices/${n.id}`)).body.acknowledgements).toHaveLength(
    1,
  );
  const oldVersion = n.version;
  const changed = await a.write(
    `/notices/${n.id}`,
    noticeEdit(n, { body: "New reading needed" }),
    "put",
  );
  expect(changed.status).toBe(200);
  n = changed.body;
  const fresh = (await c.get(`/notices/${n.id}`)).body;
  expect(fresh.acknowledged).toBe(false);
  expect(fresh.acknowledgements).toHaveLength(1);
  expect(
    (
      await c.write(`/notices/${n.id}/acknowledge`, {
        version: oldVersion,
        confirmedRead: true,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await c.write(`/notices/${n.id}/acknowledge`, {
        version: n.version,
        confirmedRead: true,
      })
    ).status,
  ).toBe(200);
  await expect(
    db.query("DELETE FROM notice_acknowledgements WHERE notice_id=$1", [n.id]),
  ).rejects.toThrow(/append only/);
});
it("separates expired and withdrawn notices, suppresses them from pinned/current views and retains history", async () => {
  const a = await client("admin"),
    c = await client();
  let n = await publish(a, await notice(a));
  await db.query(
    "UPDATE notices SET expires_at=now()-interval '1 second' WHERE id=$1",
    [n.id],
  );
  expect((await c.get("/notices")).body.items).toHaveLength(0);
  expect((await c.get("/notices?view=expired")).body.items[0].id).toBe(n.id);
  expect((await c.get("/collaboration/summary")).body.notices).toHaveLength(0);
  expect(
    (
      await c.write(`/notices/${n.id}/acknowledge`, {
        version: n.version,
        confirmedRead: true,
      })
    ).status,
  ).toBe(409);
  const result = await a.write(`/notices/${n.id}/withdraw`, {
    version: n.version,
  });
  expect(result.status).toBe(200);
  n = result.body;
  const withdrawalMessages = await db.query<{ message: string }>(
    "SELECT message FROM notifications WHERE notice_id=$1 AND event_key=$2",
    [n.id, `notice:${n.id}:version:${n.version}`],
  );
  expect(withdrawalMessages.length).toBeGreaterThan(0);
  expect(
    withdrawalMessages.every(
      (entry) => !entry.message.includes("acknowledgement is requested"),
    ),
  ).toBe(true);
  expect((await c.get(`/notices/${n.id}`)).status).toBe(404);
  expect(
    (await c.get("/notifications")).body.some(
      (x: { noticeId: string }) => x.noticeId === n.id,
    ),
  ).toBe(false);
  expect(
    (await a.get("/notices?view=withdrawn")).body.items[0].events,
  ).toBeUndefined();
  expect((await a.get(`/notices/${n.id}`)).body.events.at(-1).kind).toBe(
    "withdrawn",
  );
  expect(
    (await a.write(`/notices/${n.id}/publish`, { version: n.version })).status,
  ).toBe(400);
});
it("rejects academic/participant notice changes, stale writes, forbidden links and false read confirmations", async () => {
  const a = await client("admin"),
    c = await client("academic");
  const n = await publish(a, await notice(a));
  for (const action of ["publish", "withdraw"])
    expect(
      (await c.write(`/notices/${n.id}/${action}`, { version: n.version }))
        .status,
    ).toBe(403);
  expect((await c.write(`/notices/${n.id}`, noticeEdit(n), "put")).status).toBe(
    403,
  );
  const races = await Promise.all([
    a.write(`/notices/${n.id}`, noticeEdit(n, { body: "First change" }), "put"),
    a.write(
      `/notices/${n.id}`,
      noticeEdit(n, { body: "Second change" }),
      "put",
    ),
  ]);
  expect(races.map((x) => x.status).sort()).toEqual([200, 409]);
  expect(
    (
      await a.write("/notices", {
        title: "Bad URL",
        body: "Synthetic",
        dataLinks: [{ label: "Unsafe", url: "file:///private" }],
      })
    ).status,
  ).toBe(400);
  await expect(
    db.query("UPDATE notice_events SET kind='updated' WHERE notice_id=$1", [
      n.id,
    ]),
  ).rejects.toThrow(/append only/);
  await expect(
    db.query("DELETE FROM notices WHERE id=$1", [n.id]),
  ).rejects.toThrow(/retained/);
});
it("exports escaped private RFC5545 calendars with IST date boundaries, stable UID, revision and UTF-8 folding", async () => {
  const a = await client("admin"),
    c = await client();
  const m = await meeting(a, {
    startsAt: "2026-10-25T00:15:00+05:30",
    endsAt: "2026-10-25T01:15:00+05:30",
    title: "Synthetic, meeting; Ω".repeat(7),
    agenda: "Agenda\nBEGIN:VEVENT\nwith backslash \\ and comma, semicolon;",
  });
  const r = await c.get(`/meetings/${m.id}/calendar`);
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toContain("text/calendar");
  expect(r.headers["cache-control"]).toContain("no-store");
  expect(r.text).toContain("DTSTART;TZID=Asia/Kolkata:20261025T001500");
  expect(r.text).toContain("DTEND;TZID=Asia/Kolkata:20261025T011500");
  expect(r.text).toContain(`UID:${m.id}@quemat-lab-hub`);
  expect(r.text).toContain("CLASS:PRIVATE");
  expect(
    r.text.split("\r\n").filter((s: string) => s === "BEGIN:VEVENT"),
  ).toHaveLength(1);
  for (const line of r.text.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(r.text).not.toContain("mailto:");
  expect(meetingCalendar(m).replace(/\r\n /g, "")).toContain(
    "Synthetic\\, meeting\\; Ω",
  );
});
it("preserves all populated pre-005 rows and notification sources across additive migration and repeat application", async () => {
  const isolated = await openDatabase({ localPath: ":memory:" });
  try {
    const f = await phase3aFixture(isolated);
    await isolated.exec(
      readFileSync("server/migrations/004_issues_requests.sql", "utf8"),
    );
    await isolated.query(
      "INSERT INTO schema_migrations VALUES('004_issues_requests.sql','synthetic')",
    );
    const issue = randomUUID();
    await isolated.query(
      "INSERT INTO issues(id,reporter_id,title,description,category,priority) VALUES($1,$2,'Retained issue','Synthetic original issue','general_decision','normal')",
      [issue, f.owner],
    );
    await isolated.query(
      "INSERT INTO notifications(id,user_id,issue_id,event_key,message) VALUES($1,$2,$3,'retained-issue','Retain source')",
      [randomUUID(), f.owner, issue],
    );
    const tables = (
      await isolated.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
      )
    )
      .map((t) => t.table_name)
      .sort();
    async function snapshot() {
      const out: Record<string, unknown> = {};
      for (const table of tables) {
        out[table] = (await isolated.query(`SELECT * FROM ${table}`)).map(
          (r) => {
            const row = { ...r };
            if (table === "notifications") {
              delete row.meeting_id;
              delete row.notice_id;
            }
            return row;
          },
        );
      }
      return out;
    }
    const before = await snapshot();
    const legacy = createApp(isolated, { origin });
    expect((await request(legacy).get("/api/health")).status).toBe(503);
    await isolated.exec(
      readFileSync("server/migrations/005_meetings_notices.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    await isolated.query(
      "INSERT INTO schema_migrations VALUES('005_meetings_notices.sql','synthetic')",
    );
    await migrate(isolated);
    expect((await request(legacy).get("/api/health")).status).toBe(200);
    for (const table of [
      "meetings",
      "meeting_events",
      "notices",
      "notice_events",
      "notice_acknowledgements",
    ])
      expect(await isolated.query(`SELECT * FROM ${table}`)).toHaveLength(0);
    await expect(
      isolated.query(
        "INSERT INTO notifications(id,user_id,issue_id,weekly_report_id,event_key,message) VALUES($1,$2,$3,$4,'bad-sources','Reject mixed sources')",
        [randomUUID(), f.owner, issue, f.report],
      ),
    ).rejects.toThrow(/notification_source/);
  } finally {
    await isolated.close();
  }
}, 20000);

it("lets the supervisor monitor every meeting but only notifies her when included", async () => {
  const a = await client("admin"),
    s = await client("supervisor");
  const m = await meeting(a);
  expect((await s.get(`/meetings/${m.id}`)).status).toBe(200);
  expect((await s.get("/notifications")).body).toHaveLength(0);
  const invited = await meeting(a, { attendeeIds: [ids.supervisor] });
  expect(
    (await s.get("/notifications")).body.some(
      (n: { meetingId: string }) => n.meetingId === invited.id,
    ),
  ).toBe(true);
});
