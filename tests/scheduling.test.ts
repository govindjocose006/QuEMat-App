import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import {
  openDatabase,
  migrate,
  seed,
  instruments,
  type DB,
} from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import type { Booking } from "../shared/scheduling.js";
const origin = "http://localhost:5173",
  password = "Phase2-tests-only-password!";
let db: DB,
  app: ReturnType<typeof createApp>,
  adminId: string,
  memberId: string,
  otherId: string,
  sampleId: string,
  instrumentId: string;
async function client(email = "admin@example.test", target = app) {
  const agent = request.agent(target);
  let csrf = (await agent.get("/api/session")).body.csrfToken;
  const c = {
    agent,
    async write(
      path: string,
      data: unknown = {},
      method: "post" | "put" = "post",
    ) {
      const r = await agent[method]("/api" + path)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send(data as object);
      if (r.body.csrfToken) csrf = r.body.csrfToken;
      return r;
    },
  };
  if (email) {
    const r = await c.write("/auth/login", { email, password });
    expect(r.status, r.body.error).toBe(200);
  }
  return c;
}
const time = (offset: number) =>
  new Date(Date.now() + offset * 60000).toISOString();
function booking(extra: Record<string, unknown> = {}) {
  return {
    instrumentId,
    operatorId: memberId,
    sampleIds: [sampleId],
    measurementType: "M(T)",
    startsAt: time(60),
    endsAt: time(120),
    details: {},
    ...extra,
  };
}
async function create(
  c: Awaited<ReturnType<typeof client>>,
  extra: Record<string, unknown> = {},
) {
  const r = await c.write("/bookings", booking(extra));
  expect(r.status, r.body.error).toBe(201);
  return r.body as Booking;
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
  adminId = await bootstrapAdmin(
    db,
    "admin@example.test",
    password,
    "Administrator",
  );
  const [admin] = await db.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id=$1",
    [adminId],
  );
  memberId = randomUUID();
  otherId = randomUUID();
  for (const [id, email, name] of [
    [memberId, "member@example.test", "Operator One"],
    [otherId, "other@example.test", "Operator Two"],
  ])
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,status,onboarded,created_at) VALUES ($1,$2,$3,$4,'approved',1,$5)",
      [id, email, admin.password_hash, name, new Date().toISOString()],
    );
  app = createApp(db, { origin, authLimit: 1000 });
  instrumentId = (await instruments(db))[0].id;
  const c = await client("member@example.test");
  const s = await c.write("/samples", { compound: "FeSe", batch: "batch A" });
  expect(s.status).toBe(201);
  sampleId = s.body.id;
});
afterAll(() => db.close());
it("refreshes instrument state with usage and retains the latest old handover", async () => {
  const c = await client();
  const old = randomUUID(),
    newer = randomUUID();
  const sample = (
    await db.query("SELECT * FROM samples WHERE id=$1", [sampleId])
  )[0];
  for (const [id, days, notes] of [
    [old, 9, "Older handover"],
    [newer, 8, "Check the sample holder before use"],
  ] as const) {
    await db.query(
      `INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,actual_start,actual_end,measurement_type,handover_notes,sample_snapshots)
      VALUES($1,$2,$3,$3,'booking','completed',now()-make_interval(days=>$4)-interval '1 hour',now()-make_interval(days=>$4),now()-make_interval(days=>$4)-interval '1 hour',now()-make_interval(days=>$4),'Synthetic scan',$5,$6::jsonb)`,
      [
        id,
        instrumentId,
        memberId,
        days,
        notes,
        JSON.stringify([{ id: sampleId, code: sample.code, compound: "FeSe" }]),
      ],
    );
  }
  const initial = await c.agent.get("/api/monitoring");
  expect(initial.status, initial.body.error).toBe(200);
  expect(initial.body.instruments).toHaveLength(15);
  expect(
    initial.body.handovers
      .filter((b: Booking) => b.instrumentId === instrumentId)
      .map((b: Booking) => b.id),
  ).toEqual([newer]);
  expect(initial.body.handovers[0].sampleSnapshots[0].code).toBe(sample.code);
  expect(initial.body.bookings.some((b: Booking) => b.id === newer)).toBe(
    false,
  );
  const i = initial.body.instruments.find(
    (x: { id: string }) => x.id === instrumentId,
  );
  expect(
    (
      await c.write(
        `/instruments/${instrumentId}`,
        { ...i, status: "maintenance" },
        "put",
      )
    ).status,
  ).toBe(200);
  const refreshed = (await c.agent.get("/api/monitoring")).body;
  expect(
    refreshed.instruments.find((x: { id: string }) => x.id === instrumentId)
      .status,
  ).toBe("maintenance");
  expect(refreshed.refreshedAt).toBeTruthy();
  expect(refreshed.handovers[0].handoverNotes).toBe(
    "Check the sample holder before use",
  );
});
it("retrieves more than 200 notifications without duplicates or lost timestamp ties", async () => {
  const c = await client("member@example.test"),
    other = await client("other@example.test");
  const b = await create(c);
  await db.exec("TRUNCATE notifications");
  await db.query(
    `INSERT INTO notifications(id,user_id,booking_id,event_key,message,created_at)
    SELECT gen_random_uuid(),$1,$2,'bulk-'||n,'Synthetic update '||n,
      '2026-01-01T00:00:00Z'::timestamptz+(n%3)*interval '0.000001 second' FROM generate_series(1,205) n`,
    [memberId, b.id],
  );
  expect((await c.agent.get("/api/notifications")).body).toHaveLength(200);
  expect(
    (await c.agent.get("/api/notifications/summary")).body.unreadCount,
  ).toBe(205);
  expect(
    (await other.agent.get("/api/notifications/summary")).body.unreadCount,
  ).toBe(0);
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await c.agent.get(
      "/api/notifications/page?path=notifications%2Fpage&limit=50&unread=true" +
        (cursor ? `&before=${cursor}` : ""),
    );
    expect(page.status, page.body.error).toBe(200);
    for (const n of page.body.items) {
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
    }
    cursor = page.body.nextCursor;
  } while (cursor);
  expect(ids.size).toBe(205);
  const first = [...ids][0];
  expect((await other.write(`/notifications/${first}/read`)).status).toBe(404);
  expect((await c.write(`/notifications/${first}/read`)).status).toBe(200);
  expect(
    (await c.agent.get("/api/notifications/summary")).body.unreadCount,
  ).toBe(204);
  expect(
    (await c.agent.get("/api/notifications/page?unread=true")).body.items.some(
      (n: { id: string }) => n.id === first,
    ),
  ).toBe(false);
  expect(
    (await c.agent.get("/api/notifications/page")).body.items.find(
      (n: { id: string }) => n.id === first,
    ).readAt,
  ).toBeTruthy();
});
it("accepts Vercel routing metadata without changing notification visibility or filter validation", async () => {
  const c = await client("member@example.test");
  await create(c);
  const baseline = await c.agent.get("/api/notifications/page?unread=true");
  expect(baseline.status).toBe(200);
  for (const path of [
    "path=notifications%2Fpage",
    "path=notifications&path=page",
  ]) {
    const page = await c.agent.get(
      `/api/notifications/page?unread=true&${path}`,
    );
    expect(page.status, page.body.error).toBe(200);
    expect(page.body).toEqual(baseline.body);
  }
  const other = await client("other@example.test");
  const scoped = await other.agent.get(
    "/api/notifications/page?path=notifications%2Fpage",
  );
  expect(scoped.status).toBe(200);
  expect(scoped.body.items).toEqual([]);
  for (const query of ["limit=0", "before=bad", "unread=maybe", "extra=1"]) {
    const result = await c.agent.get(
      `/api/notifications/page?path=notifications%2Fpage&${query}`,
    );
    expect(result.status).toBe(400);
  }
  expect(
    (
      await request(app).get(
        "/api/notifications/page?path=notifications%2Fpage",
      )
    ).status,
  ).toBe(401);
});
it("keeps notification cursors stable when new updates arrive and validates page inputs", async () => {
  const c = await client("member@example.test");
  const b = await create(c);
  await db.exec("TRUNCATE notifications");
  await db.query(
    `INSERT INTO notifications(id,user_id,booking_id,event_key,message,created_at)
    SELECT gen_random_uuid(),$1,$2,'page-'||n,'Original '||n,'2026-01-01T00:00:00Z' FROM generate_series(1,4) n`,
    [memberId, b.id],
  );
  const first = (await c.agent.get("/api/notifications/page?limit=2")).body;
  await db.query(
    "INSERT INTO notifications(id,user_id,booking_id,event_key,message) VALUES($1,$2,$3,'new-update','Newer update')",
    [randomUUID(), memberId, b.id],
  );
  const second = (
    await c.agent.get(
      `/api/notifications/page?limit=2&before=${first.nextCursor}`,
    )
  ).body;
  expect(
    new Set([...first.items, ...second.items].map((n: { id: string }) => n.id))
      .size,
  ).toBe(4);
  expect(second.nextCursor).toBeNull();
  expect(second.unreadCount).toBe(5);
  for (const query of [
    "limit=0",
    "limit=101",
    "before=bad",
    "unread=maybe",
    "extra=1",
  ])
    expect((await c.agent.get(`/api/notifications/page?${query}`)).status).toBe(
      400,
    );
});
it("migrates additively and preserves Phase 1 records when repeated", async () => {
  await migrate(db);
  expect((await instruments(db)).length).toBe(15);
  expect((await db.query("SELECT id FROM users")).length).toBe(3);
  expect((await db.query("SELECT id FROM samples")).length).toBe(1);
});
it("blocks anonymous/pending access, forged owners, academic privilege escalation, and maintenance by members", async () => {
  const paths = [
    "samples",
    "bookings",
    "operators",
    "availability",
    "notifications",
    "notifications/page",
    "notifications/summary",
    "monitoring",
  ];
  for (const p of paths)
    await request(app)
      .get("/api/" + p)
      .expect(401);
  const c = await client("member@example.test");
  const b = await create(c, { bookedBy: adminId, status: "in_progress" });
  expect(b.bookedBy).toBe(memberId);
  expect(b.status).toBe("confirmed");
  expect(
    (
      await c.write("/maintenance", {
        instrumentId,
        startsAt: time(200),
        endsAt: time(250),
        reason: "Repair",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await c.write("/availability", {
        instrumentId,
        startsAt: time(200),
        endsAt: time(250),
        reason: "Allocated",
      })
    ).status,
  ).toBe(403);
  await db.query(
    "UPDATE users SET status='pending',academic_role='Supervisor' WHERE id=$1",
    [memberId],
  );
  for (const p of paths) await c.agent.get("/api/" + p).expect(403);
});
it("assigns unique sample IDs, restricts edits, preserves booking snapshots and links after changes", async () => {
  const c = await client("member@example.test"),
    other = await client("other@example.test");
  const b = await create(c),
    s = (await c.agent.get("/api/samples")).body[0];
  const created = await Promise.all([
    c.write("/samples", { compound: "FeSe" }),
    c.write("/samples", { compound: "FeSe" }),
  ]);
  expect(new Set(created.map((r) => r.body.code)).size).toBe(2);
  expect(
    (await other.write("/samples/" + sampleId, { ...s, compound: "No" }, "put"))
      .status,
  ).toBe(403);
  expect(
    (
      await c.write(
        "/samples/" + sampleId,
        { ...s, compound: "New description" },
        "put",
      )
    ).status,
  ).toBe(200);
  expect(
    (await c.write("/samples/" + sampleId, { ...s, compound: "Stale" }, "put"))
      .status,
  ).toBe(409);
  const moved = await c.write(
    "/bookings/" + b.id,
    {
      ...booking(),
      version: b.version,
      startsAt: time(150),
      endsAt: time(180),
    },
    "put",
  );
  expect(moved.status, moved.body.error).toBe(200);
  expect(moved.body.sampleSnapshots[0].compound).toBe("FeSe");
  expect(moved.body.sampleSnapshots[0].batch).toBe("batch A");
  expect(
    (await c.agent.get(`/api/samples/${sampleId}/bookings`)).body[0].id,
  ).toBe(b.id);
});
it("rejects simultaneous bookings across two app instances and independently enforces raw SQL exclusion", async () => {
  const c = await client("member@example.test"),
    d = await client(
      "other@example.test",
      createApp(db, { origin, authLimit: 1000 }),
    );
  const input = booking();
  const results = await Promise.all([
    c.write("/bookings", input),
    d.write("/bookings", input),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const b = results.find((r) => r.status === 201)!.body;
  await expect(
    db.query(
      `INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type) VALUES ($1,$2,$3,$3,'booking','confirmed',$4,$5,'Direct SQL')`,
      [randomUUID(), instrumentId, memberId, b.startsAt, b.endsAt],
    ),
  ).rejects.toMatchObject({ code: "23P01" });
  expect((await db.query("SELECT id FROM bookings")).length).toBe(1);
});
it("applies buffers and maintenance conflicts, allows exact adjacency, and releases cancelled slots", async () => {
  const c = await client("member@example.test"),
    admin = await client();
  await db.query(
    "UPDATE instruments SET setup_minutes=10,cleanup_minutes=15 WHERE id=$1",
    [instrumentId],
  );
  const startsAt = time(60),
    endsAt = time(120),
    b = await create(c, { startsAt, endsAt });
  expect(
    (
      await c.write(
        "/bookings",
        booking({ startsAt: endsAt, endsAt: time(180) }),
      )
    ).status,
  ).toBe(409);
  const adjacent = new Date(Date.parse(endsAt) + 25 * 60000).toISOString();
  await create(c, { startsAt: adjacent, endsAt: time(190) });
  const conflicting = await admin.write("/maintenance", {
    instrumentId,
    startsAt,
    endsAt,
    reason: "Repair",
  });
  expect(conflicting.status).toBe(409);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "cancel",
      })
    ).status,
  ).toBe(200);
  const block = await admin.write("/maintenance", {
    instrumentId,
    startsAt,
    endsAt,
    reason: "Repair",
  });
  expect(block.status).toBe(201);
  expect(
    (await c.write("/bookings", booking({ startsAt, endsAt }))).status,
  ).toBe(409);
  expect(
    (
      await admin.write(`/bookings/${block.body.id}/actions`, {
        version: 1,
        action: "cancel",
      })
    ).status,
  ).toBe(200);
  await create(c, { startsAt, endsAt });
});
it("requires approval, active operators, and allocated windows including buffers", async () => {
  const c = await client("member@example.test"),
    admin = await client();
  await db.query(
    "UPDATE instruments SET coordinator_approval=1,scheduling_mode='allocated',setup_minutes=10 WHERE id=$1",
    [instrumentId],
  );
  expect((await c.write("/bookings", booking())).status).toBe(409);
  expect(
    (
      await admin.write("/availability", {
        instrumentId,
        startsAt: time(30),
        endsAt: time(180),
        reason: "Institute allocation A",
      })
    ).status,
  ).toBe(201);
  const b = await create(c);
  expect(b.status).toBe("requested");
  expect(b.allocationReference).toBe("Institute allocation A");
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "confirm",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await admin.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "reject",
      })
    ).status,
  ).toBe(200);
  const again = await create(c);
  expect(
    (
      await admin.write(`/bookings/${again.id}/actions`, {
        version: 1,
        action: "confirm",
      })
    ).status,
  ).toBe(200);
  await db.query("UPDATE users SET status='inactive' WHERE id=$1", [otherId]);
  expect(
    (
      await c.write(
        "/bookings",
        booking({
          operatorId: otherId,
          startsAt: time(130),
          endsAt: time(160),
        }),
      )
    ).status,
  ).toBe(400);
});
it("enforces all four furnace maxima, database checks, and explicit unloading for completion", async () => {
  const c = await client("member@example.test");
  for (const furnace of (await instruments(db)).filter(
    (i) => i.category === "Furnace",
  )) {
    expect(
      (
        await c.write(
          "/bookings",
          booking({
            instrumentId: furnace.id,
            details: { targetTemperatureC: furnace.maxTemperatureC! + 1 },
          }),
        )
      ).status,
    ).toBe(400);
    const b = await create(c, {
      instrumentId: furnace.id,
      startsAt: time(-1),
      endsAt: time(10),
      details: { targetTemperatureC: furnace.maxTemperatureC },
    });
    expect(
      (
        await c.write(`/bookings/${b.id}/actions`, {
          version: 1,
          action: "checkin",
        })
      ).status,
    ).toBe(200);
    // Changing a configured maximum must not prevent safely completing an existing run.
    await db.query(
      "UPDATE instruments SET max_temperature_c=500,category='Renamed furnace category' WHERE id=$1",
      [furnace.id],
    );
    const completion = {
      version: 2,
      action: "complete",
      summary: "Finished",
      handoverNotes: "Safe to use",
    };
    expect(
      (await c.write(`/bookings/${b.id}/actions`, completion)).status,
    ).toBe(400);
    await expect(
      db.query(
        "UPDATE bookings SET status='completed',actual_end=now() WHERE id=$1",
        [b.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await c.write(`/bookings/${b.id}/actions`, {
          ...completion,
          unloaded: true,
        })
      ).status,
    ).toBe(200);
  }
});
it("keeps overdue actual usage occupied, reports impacts without moving another reservation, and writes private notifications", async () => {
  const c = await client("member@example.test"),
    other = await client("other@example.test");
  const b = await create(c, { startsAt: time(-10), endsAt: time(1) });
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "checkin",
      })
    ).status,
  ).toBe(200);
  // Advance only this isolated fixture's scheduled end to simulate elapsed time.
  await db.query(
    "UPDATE bookings SET ends_at=now()-interval '2 minutes' WHERE id=$1",
    [b.id],
  );
  const next = await create(other, {
    operatorId: otherId,
    startsAt: time(-1),
    endsAt: time(20),
  });
  expect(
    (
      await other.write(`/bookings/${next.id}/actions`, {
        version: 1,
        action: "checkin",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 2,
        action: "overrun",
        overrunUntil: time(15),
        handoverNotes: "Cooling taking longer",
      })
    ).status,
  ).toBe(200);
  expect(
    (await other.agent.get("/api/bookings/" + next.id)).body.startsAt,
  ).toBe(next.startsAt);
  const inbox = (await other.agent.get("/api/notifications")).body;
  expect(
    inbox.some((n: { message: string }) => n.message.includes("overrun")),
  ).toBe(true);
  const alert = inbox.find((n: { message: string }) =>
    n.message.includes("overrun"),
  );
  expect((await c.write(`/notifications/${alert.id}/read`)).status).toBe(404);
  expect((await other.write(`/notifications/${alert.id}/read`)).status).toBe(
    200,
  );
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 3,
        action: "complete",
        summary: "Finished",
        handoverNotes: "Clear",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await other.write(`/bookings/${next.id}/actions`, {
        version: 1,
        action: "checkin",
      })
    ).status,
  ).toBe(200);
});
it("prevents unauthorized lifecycle changes, stale actions, early check-in and cancellation of actual usage", async () => {
  const c = await client("member@example.test"),
    other = await client("other@example.test");
  const b = await create(c);
  expect(
    (
      await other.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "cancel",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "checkin",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await c.write(
        "/bookings/" + b.id,
        { ...booking({ startsAt: time(-1), endsAt: time(20) }), version: 1 },
        "put",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 1,
        action: "cancel",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 2,
        action: "checkin",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 3,
        action: "cancel",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 3,
        action: "interrupt",
        summary: "Issue",
        handoverNotes: "Inspect before reuse",
      })
    ).status,
  ).toBe(200);
});
it("retains actual cleanup protection and prevents concurrent conflicting reschedules", async () => {
  const c = await client("member@example.test");
  await db.query("UPDATE instruments SET cleanup_minutes=5 WHERE id=$1", [
    instrumentId,
  ]);
  const b = await create(c, { startsAt: time(-10), endsAt: time(1) });
  await c.write(`/bookings/${b.id}/actions`, { version: 1, action: "checkin" });
  await db.query(
    "UPDATE bookings SET ends_at=now()-interval '7 minutes' WHERE id=$1",
    [b.id],
  );
  const next = await create(c, { startsAt: time(-1), endsAt: time(20) });
  expect(
    (
      await c.write(`/bookings/${b.id}/actions`, {
        version: 2,
        action: "complete",
        summary: "Done",
        handoverNotes: "Cleanup underway",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await c.write(`/bookings/${next.id}/actions`, {
        version: 1,
        action: "checkin",
      })
    ).status,
  ).toBe(409);
  const a = await create(c, { startsAt: time(60), endsAt: time(90) }),
    d = await create(c, { startsAt: time(120), endsAt: time(150) });
  const input = {
    ...booking({ startsAt: time(180), endsAt: time(210) }),
    version: 1,
  };
  const result = await Promise.all([
    c.write("/bookings/" + a.id, input, "put"),
    c.write("/bookings/" + d.id, input, "put"),
  ]);
  expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
});
it("requires CSRF and returns shared calendar without exposing account emails or secrets", async () => {
  const c = await client("member@example.test");
  await create(c);
  await c.agent.post("/api/samples").send({ compound: "Bad" }).expect(403);
  const list = await c.agent
    .get("/api/bookings")
    .query({ from: time(-1440), to: time(1440) })
    .expect(200);
  expect(list.body).toHaveLength(1);
  expect(JSON.stringify(list.body)).not.toContain("@example.test");
  expect(list.headers["cache-control"]).toBe("no-store");
  expect(
    JSON.stringify((await c.agent.get("/api/operators")).body),
  ).not.toContain("email");
});

it("includes actual cleanup outside the requested calendar dates", async () => {
  const c = await client("member@example.test");
  await db.query("UPDATE instruments SET cleanup_minutes=10080 WHERE id=$1", [
    instrumentId,
  ]);
  const b = await create(c, { startsAt: time(-1), endsAt: time(1) });
  await c.write(`/bookings/${b.id}/actions`, { version: 1, action: "checkin" });
  await c.write(`/bookings/${b.id}/actions`, {
    version: 2,
    action: "complete",
    summary: "Done",
    handoverNotes: "Long cleanup",
  });
  const result = await c.agent
    .get("/api/bookings")
    .query({ from: time(20000), to: time(21000) })
    .expect(200);
  expect(result.body.map((row: Booking) => row.id)).toContain(b.id);
});

it("keeps booking approval work out of supervisor broadcasts while retaining monitoring and participant alerts", async () => {
  await db.query("UPDATE users SET app_role='supervisor' WHERE id=$1", [
    otherId,
  ]);
  await db.query("UPDATE instruments SET coordinator_approval=1 WHERE id=$1", [
    instrumentId,
  ]);
  const c = await client("member@example.test"),
    s = await client("other@example.test"),
    a = await client();
  const b = await create(c);
  expect(b.status).toBe("requested");
  expect((await s.agent.get(`/api/bookings/${b.id}`)).status).toBe(200);
  expect((await s.agent.get("/api/notifications")).body).toHaveLength(0);
  expect(
    (await a.agent.get("/api/notifications")).body.some(
      (n: { bookingId: string }) => n.bookingId === b.id,
    ),
  ).toBe(true);
  const involved = await create(c, {
    startsAt: time(180),
    endsAt: time(240),
    participantIds: [otherId],
  });
  expect(
    (await s.agent.get("/api/notifications")).body.some(
      (n: { bookingId: string }) => n.bookingId === involved.id,
    ),
  ).toBe(true);
});
