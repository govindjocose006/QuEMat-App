import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, instruments, member, type DB, type SQL } from "./db.js";
import type { Member } from "../shared/schema.js";
import {
  sampleSchema,
  bookingSchema,
  blockSchema,
  actionSchema,
  managesOperations,
  type Booking,
  type BookingInput,
  type Sample,
} from "../shared/scheduling.js";

const sampleSelect = `SELECT s.id,s.code,s.owner_id AS "ownerId",u.full_name AS "ownerName",s.compound,s.project,s.batch,
 to_char(s.prepared_on,'YYYY-MM-DD') AS "preparedOn",s.origin,s.physical_form AS "physicalForm",s.quantity,s.storage,s.notes,s.archived,s.version,s.created_at AS "createdAt"
 FROM samples s JOIN users u ON u.id=s.owner_id`;
const bookingSelect = `SELECT b.id,b.instrument_id AS "instrumentId",i.name AS "instrumentName",b.instrument_category AS category,b.booked_by AS "bookedBy",u.full_name AS "bookerName",
 b.operator_id AS "operatorId",COALESCE(o.full_name,'Maintenance') AS "operatorName",b.kind,b.status,b.starts_at AS "startsAt",b.ends_at AS "endsAt",
 b.reserved_start AS "reservedStart",b.reserved_end AS "reservedEnd",b.setup_minutes AS "setupMinutes",b.cleanup_minutes AS "cleanupMinutes",
 b.measurement_type AS "measurementType",b.project,b.sample_snapshots AS "sampleSnapshots",b.participants,b.details,b.setup_notes AS "setupNotes",
 b.allocation_reference AS "allocationReference",b.actual_start AS "actualStart",b.actual_end AS "actualEnd",b.unloaded,b.completion_summary AS "completionSummary",
 b.data_link AS "dataLink",b.handover_notes AS "handoverNotes",b.overrun_until AS "overrunUntil",b.version,b.updated_at AS "updatedAt"
 FROM bookings b JOIN instruments i ON i.id=b.instrument_id JOIN users u ON u.id=b.booked_by LEFT JOIN users o ON o.id=b.operator_id`;
// Share visibility rules across the legacy list, paginated inbox, badge and reads.
const notificationVisible = `n.user_id=$1
 AND (n.meeting_id IS NULL OR EXISTS(SELECT 1 FROM users p WHERE p.id=$1 AND p.app_role IN ('supervisor','administrator')) OR EXISTS(SELECT 1 FROM meeting_attendees a WHERE a.meeting_id=n.meeting_id AND a.user_id=$1))
 AND (n.notice_id IS NULL OR EXISTS(SELECT 1 FROM notices x WHERE x.id=n.notice_id AND x.status='published') OR EXISTS(SELECT 1 FROM users p WHERE p.id=$1 AND p.app_role IN ('supervisor','administrator')))`;
const notificationSelect = `SELECT n.id,n.booking_id AS "bookingId",n.weekly_report_id AS "weeklyReportId",n.order_id AS "orderId",n.issue_id AS "issueId",n.meeting_id AS "meetingId",n.notice_id AS "noticeId",n.message,n.created_at AS "createdAt",n.read_at AS "readAt" FROM notifications n`;
// pg and PGlite both serialize timestamptz to ISO through JSON.
export async function readBooking(tx: SQL, id: string) {
  return (await tx.query<Booking>(bookingSelect + " WHERE b.id=$1", [id]))[0];
}
export function installScheduling(
  app: Express,
  db: DB,
  approved: RequestHandler,
  current: (res: Response) => Member,
  fail: (status: number, message: string) => never,
) {
  async function actor(tx: SQL, res: Response) {
    const u = await member(tx, current(res).id);
    if (!u || u.status !== "approved" || !u.onboarded)
      fail(403, "Approved membership is required.");
    return u;
  }
  const manager = (u: Member) => {
    if (!managesOperations(u.appRole))
      fail(403, "Administrator or supervisor permission is required.");
  };
  const owner = (u: Member, b: Booking) => {
    if (
      !managesOperations(u.appRole) &&
      b.bookedBy !== u.id &&
      b.operatorId !== u.id
    )
      fail(
        403,
        "Only the booker, operator, or lab manager can change this booking.",
      );
  };
  async function notify(
    tx: SQL,
    b: Booking,
    verb: string,
    extraIds: string[] = [],
  ) {
    const ids = new Set(
      [
        b.bookedBy,
        b.operatorId,
        ...b.participants.map((p) => p.id),
        ...extraIds,
      ].filter((id): id is string => !!id),
    );
    if (b.status === "requested")
      for (const u of await tx.query<{ id: string }>(
        "SELECT id FROM users WHERE status='approved' AND app_role IN ('administrator','supervisor')",
      ))
        ids.add(u.id);
    for (const id of ids)
      await tx.query(
        "INSERT INTO notifications(id,user_id,booking_id,event_key,message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING",
        [
          randomUUID(),
          id,
          b.id,
          `${b.id}:${b.version}:${verb}`,
          `${b.instrumentName}: ${verb}. ${b.measurementType}.`,
        ],
      );
  }
  app.get("/api/operators", approved, async (_req, res) =>
    res.json(
      await db.query(
        "SELECT id,full_name AS \"fullName\" FROM users WHERE status='approved' AND onboarded=1 ORDER BY full_name",
      ),
    ),
  );
  app.get("/api/monitoring", approved, async (_req, res) => {
    const snapshot = await db.transaction(async (tx) => {
      await tx.exec(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const now = Date.now();
      return {
        instruments: await instruments(tx),
        bookings: await tx.query<Booking>(
          bookingSelect +
            ` WHERE (b.reserved_start<$2 AND b.reserved_end>$1) OR b.status='in_progress' OR b.actual_end+make_interval(mins=>b.cleanup_minutes)>now() ORDER BY b.starts_at,b.id`,
          [
            new Date(now - 86400000).toISOString(),
            new Date(now + 90 * 86400000).toISOString(),
          ],
        ),
        // Last actual handover per instrument, even when it predates the calendar window.
        handovers: await tx.query<Booking>(
          bookingSelect +
            ` WHERE b.id IN (SELECT DISTINCT ON (instrument_id) id FROM bookings WHERE kind='booking' AND status IN ('completed','interrupted') AND actual_end IS NOT NULL ORDER BY instrument_id,actual_end DESC,id DESC)`,
        ),
        refreshedAt: new Date().toISOString(),
      };
    });
    res.json(snapshot);
  });
  app.get("/api/samples", approved, async (_req, res) =>
    res.json(await db.query(sampleSelect + " ORDER BY s.created_at DESC")),
  );
  app.post("/api/samples", approved, async (req, res) => {
    const input = sampleSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res);
      await tx.query(
        `INSERT INTO samples(id,owner_id,compound,project,batch,prepared_on,origin,physical_form,quantity,storage,notes,archived)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          u.id,
          input.compound,
          input.project,
          input.batch,
          input.preparedOn,
          input.origin,
          input.physicalForm,
          input.quantity,
          input.storage,
          input.notes,
          input.archived,
        ],
      );
      await audit(tx, u.id, "sample.created", id, { after: input });
    });
    res
      .status(201)
      .json((await db.query(sampleSelect + " WHERE s.id=$1", [id]))[0]);
  });
  app.put("/api/samples/:id", approved, async (req, res) => {
    const input = sampleSchema
        .extend({ version: z.number().int().positive() })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        before = (
          await tx.query<Sample>(sampleSelect + " WHERE s.id=$1", [id])
        )[0];
      if (!before) fail(404, "Sample not found.");
      if (before.ownerId !== u.id && !managesOperations(u.appRole))
        fail(403, "Only the sample owner or a lab manager can edit it.");
      if (before.version !== input.version)
        fail(409, "This sample changed. Refresh before editing.");
      await tx.query(
        `UPDATE samples SET compound=$1,project=$2,batch=$3,prepared_on=$4,origin=$5,physical_form=$6,quantity=$7,storage=$8,notes=$9,archived=$10,version=version+1,updated_at=now() WHERE id=$11`,
        [
          input.compound,
          input.project,
          input.batch,
          input.preparedOn,
          input.origin,
          input.physicalForm,
          input.quantity,
          input.storage,
          input.notes,
          input.archived,
          id,
        ],
      );
      await audit(tx, u.id, "sample.updated", id, { before, after: input });
    });
    res.json((await db.query(sampleSelect + " WHERE s.id=$1", [id]))[0]);
  });
  app.get("/api/bookings", approved, async (req, res) => {
    const range = z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .parse(req.query);
    if (
      Date.parse(range.to) <= Date.parse(range.from) ||
      Date.parse(range.to) - Date.parse(range.from) > 366 * 86400000
    )
      fail(400, "Choose a date range of at most one year.");
    res.json(
      await db.query(
        bookingSelect +
          ` WHERE (b.reserved_start<$2 AND b.reserved_end>$1) OR b.status='in_progress' OR b.actual_end+make_interval(mins=>b.cleanup_minutes)>now() ORDER BY b.starts_at`,
        [range.from, range.to],
      ),
    );
  });
  app.get("/api/samples/:id/bookings", approved, async (req, res) =>
    res.json(
      await db.query(
        bookingSelect +
          " JOIN booking_samples bs ON bs.booking_id=b.id WHERE bs.sample_id=$1 ORDER BY b.starts_at DESC",
        [String(req.params.id)],
      ),
    ),
  );
  app.get("/api/bookings/:id", approved, async (req, res) => {
    const b = await readBooking(db, String(req.params.id));
    if (!b) fail(404, "Booking not found.");
    res.json(b);
  });
  async function validateBooking(tx: SQL, input: BookingInput) {
    const i = (await instruments(tx, true)).find(
      (i) => i.id === input.instrumentId,
    );
    if (!i || i.archived || i.status !== "available")
      fail(
        409,
        "This instrument is archived, under maintenance, or out of service.",
      );
    if (Date.parse(input.endsAt) <= Date.now())
      fail(400, "A reservation must end in the future.");
    if (Date.parse(input.endsAt) - Date.parse(input.startsAt) > 90 * 86400000)
      fail(400, "A reservation may span at most 90 days.");
    const ids = [...new Set([input.operatorId, ...input.participantIds])];
    const people = await tx.query<{ id: string; name: string }>(
      "SELECT id,full_name AS name FROM users WHERE id=ANY($1::text[]) AND status='approved' AND onboarded=1",
      [ids],
    );
    if (people.length !== ids.length)
      fail(400, "Operators and participants must be approved active members.");
    if (
      i.category === "Furnace" &&
      (!input.details.targetTemperatureC ||
        !i.maxTemperatureC ||
        input.details.targetTemperatureC > i.maxTemperatureC)
    )
      fail(
        400,
        "Furnace target temperature must be within its configured maximum.",
      );
    if (
      i.name.toLowerCase().includes("sputter") &&
      (!input.details.targetMaterial || !input.details.substrate)
    )
      fail(400, "Sputtering requires target material and substrate.");
    const samples = await tx.query<Sample>(
      sampleSelect + " WHERE s.id=ANY($1::text[]) AND s.archived=false",
      [[...new Set(input.sampleIds)]],
    );
    if (samples.length !== new Set(input.sampleIds).size)
      fail(400, "Choose existing, active samples.");
    let allocation = "";
    if (i.schedulingMode === "allocated") {
      const windows = await tx.query<{ reference: string }>(
        `SELECT reference FROM availability_windows WHERE instrument_id=$1 AND starts_at<=$2::timestamptz-make_interval(mins=>$4) AND ends_at>=$3::timestamptz+make_interval(mins=>$5) ORDER BY starts_at`,
        [i.id, input.startsAt, input.endsAt, i.setupMinutes, i.cleanupMinutes],
      );
      if (!windows.length)
        fail(
          409,
          "The booking and buffers must fit an institutionally allocated availability window.",
        );
      allocation = windows[0].reference;
    }
    return {
      i,
      samples,
      participants: people.filter((p) => input.participantIds.includes(p.id)),
      allocation,
    };
  }
  app.post("/api/bookings", approved, async (req, res) => {
    const input = bookingSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        v = await validateBooking(tx, input);
      await tx.query(
        `INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,project,sample_snapshots,participants,details,setup_notes,allocation_reference)
       VALUES ($1,$2,$3,$4,'booking',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          input.instrumentId,
          u.id,
          input.operatorId,
          v.i.coordinatorApproval ? "requested" : "confirmed",
          input.startsAt,
          input.endsAt,
          input.measurementType,
          input.project,
          JSON.stringify(v.samples),
          JSON.stringify(v.participants),
          JSON.stringify(input.details),
          input.setupNotes,
          v.allocation,
        ],
      );
      for (const s of v.samples)
        await tx.query("INSERT INTO booking_samples VALUES ($1,$2)", [
          id,
          s.id,
        ]);
      const after = await readBooking(tx, id);
      await audit(tx, u.id, "booking.created", id, { after });
      await notify(tx, after, "booking created");
    });
    res.status(201).json(await readBooking(db, id));
  });
  app.put("/api/bookings/:id", approved, async (req, res) => {
    const input = bookingSchema.parse(req.body),
      version = z.number().int().positive().parse(req.body.version),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        before = await readBooking(tx, id);
      if (!before) fail(404, "Booking not found.");
      owner(u, before);
      if (before.version !== version)
        fail(409, "This booking changed. Refresh before editing.");
      if (
        before.kind !== "booking" ||
        !["requested", "confirmed"].includes(before.status)
      )
        fail(409, "Only scheduled bookings can be edited or rescheduled.");
      const v = await validateBooking(tx, input);
      // Keep historical descriptions for unchanged sample selections.
      const snapshots = v.samples.map(
        (s) => before.sampleSnapshots.find((old) => old.id === s.id) ?? s,
      );
      await tx.query(
        `UPDATE bookings SET instrument_id=$1,operator_id=$2,starts_at=$3,ends_at=$4,measurement_type=$5,project=$6,sample_snapshots=$7,participants=$8,details=$9,setup_notes=$10,allocation_reference=$11,status=$12,version=version+1,updated_at=now() WHERE id=$13`,
        [
          input.instrumentId,
          input.operatorId,
          input.startsAt,
          input.endsAt,
          input.measurementType,
          input.project,
          JSON.stringify(snapshots),
          JSON.stringify(v.participants),
          JSON.stringify(input.details),
          input.setupNotes,
          v.allocation,
          v.i.coordinatorApproval ? "requested" : "confirmed",
          id,
        ],
      );
      await tx.query("DELETE FROM booking_samples WHERE booking_id=$1", [id]);
      for (const s of v.samples)
        await tx.query("INSERT INTO booking_samples VALUES ($1,$2)", [
          id,
          s.id,
        ]);
      const after = await readBooking(tx, id);
      await audit(tx, u.id, "booking.rescheduled", id, { before, after });
      await notify(tx, after, "booking changed", [
        before.operatorId!,
        ...before.participants.map((p) => p.id),
      ]);
    });
    res.json(await readBooking(db, id));
  });
  app.post("/api/maintenance", approved, async (req, res) => {
    const input = blockSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res);
      manager(u);
      if (!(await instruments(tx)).some((i) => i.id === input.instrumentId))
        fail(400, "Choose an active instrument.");
      await tx.query(
        `INSERT INTO bookings(id,instrument_id,booked_by,kind,status,starts_at,ends_at,measurement_type) VALUES ($1,$2,$3,'maintenance','confirmed',$4,$5,$6)`,
        [
          id,
          input.instrumentId,
          u.id,
          input.startsAt,
          input.endsAt,
          input.reason,
        ],
      );
      await audit(tx, u.id, "maintenance.created", id, {
        after: await readBooking(tx, id),
      });
    });
    res.status(201).json(await readBooking(db, id));
  });
  app.get("/api/availability", approved, async (_req, res) =>
    res.json(
      await db.query(
        'SELECT id,instrument_id AS "instrumentId",starts_at AS "startsAt",ends_at AS "endsAt",reference FROM availability_windows ORDER BY starts_at',
      ),
    ),
  );
  app.post("/api/availability", approved, async (req, res) => {
    const input = blockSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res);
      manager(u);
      if (!(await instruments(tx)).some((i) => i.id === input.instrumentId))
        fail(400, "Choose an active instrument.");
      await tx.query(
        "INSERT INTO availability_windows VALUES ($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.instrumentId,
          input.startsAt,
          input.endsAt,
          input.reason,
          u.id,
        ],
      );
      await audit(tx, u.id, "availability.created", id, { after: input });
    });
    res.status(201).json({ id });
  });
  app.post("/api/bookings/:id/actions", approved, async (req, res) => {
    const input = actionSchema.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        before = await readBooking(tx, id);
      if (!before) fail(404, "Booking not found.");
      owner(u, before);
      if (before.kind === "maintenance") manager(u);
      if (before.version !== input.version)
        fail(409, "This booking changed. Refresh before trying again.");
      const action = input.action,
        now = new Date().toISOString();
      let status = before.status;
      if (action === "confirm" || action === "reject") {
        manager(u);
        if (status !== "requested")
          fail(409, "Only requested bookings can be approved or rejected.");
        if (action === "confirm")
          await validateBooking(
            tx,
            bookingSchema.parse({
              instrumentId: before.instrumentId,
              operatorId: before.operatorId,
              participantIds: before.participants.map((p) => p.id),
              sampleIds: before.sampleSnapshots.map((s) => s.id),
              measurementType: before.measurementType,
              project: before.project,
              startsAt: new Date(before.startsAt).toISOString(),
              endsAt: new Date(before.endsAt).toISOString(),
              setupNotes: before.setupNotes,
              details: before.details,
            }),
          );
        status = action === "confirm" ? "confirmed" : "rejected";
      } else if (action === "cancel") {
        if (!["requested", "confirmed"].includes(status))
          fail(
            409,
            "A running experiment must be completed or interrupted, with handover.",
          );
        status = "cancelled";
      } else if (action === "checkin") {
        if (before.kind !== "booking" || status !== "confirmed")
          fail(409, "Only confirmed measurements can be checked in.");
        if (!managesOperations(u.appRole) && u.id !== before.operatorId)
          fail(403, "Only the actual operator or a lab manager can check in.");
        const i = (await instruments(tx, true)).find(
          (i) => i.id === before.instrumentId,
        )!;
        if (i.archived || i.status !== "available")
          fail(409, "This instrument is not operational.");
        if (
          Date.now() < new Date(before.startsAt).getTime() ||
          Date.now() >= new Date(before.endsAt).getTime()
        )
          fail(
            409,
            "Check in during the scheduled interval; reschedule a missed booking first.",
          );
        if (
          (
            await tx.query(
              `SELECT id FROM bookings WHERE instrument_id=$1 AND id<>$2 AND (status='in_progress' OR actual_end+make_interval(mins=>cleanup_minutes)>now())`,
              [before.instrumentId, id],
            )
          ).length
        )
          fail(
            409,
            "Previous usage or its cleanup is still active. Completion/unloading is required.",
          );
        status = "in_progress";
        await tx.query("UPDATE bookings SET actual_start=$1 WHERE id=$2", [
          now,
          id,
        ]);
      } else if (action === "complete" || action === "interrupt") {
        if (status !== "in_progress")
          fail(409, "Only actual usage can be completed or interrupted.");
        if (!input.summary.trim() || !input.handoverNotes.trim())
          fail(400, "Record a completion summary and handover notes.");
        if (before.category === "Furnace" && !input.unloaded)
          fail(
            400,
            "Confirm that the furnace is unloaded before releasing it.",
          );
        status = action === "complete" ? "completed" : "interrupted";
        // Set status with actual_end atomically to preserve the actual-usage constraint.
        await tx.query(
          "UPDATE bookings SET status=$1,actual_end=$2,unloaded=$3,completion_summary=$4,handover_notes=$5,data_link=$6 WHERE id=$7",
          [
            status,
            now,
            input.unloaded,
            input.summary,
            input.handoverNotes,
            input.dataLink,
            id,
          ],
        );
      } else if (action === "overrun") {
        if (
          status !== "in_progress" ||
          !input.overrunUntil ||
          Date.parse(input.overrunUntil) <=
            Math.max(Date.now(), new Date(before.endsAt).getTime()) ||
          !input.handoverNotes.trim()
        )
          fail(
            400,
            "For active usage, provide a later estimated end and handover notes.",
          );
        await tx.query(
          "UPDATE bookings SET overrun_until=$1,handover_notes=$2 WHERE id=$3",
          [input.overrunUntil, input.handoverNotes, id],
        );
        const affected = await tx.query<{
          booked_by: string;
          operator_id: string;
        }>(
          `SELECT booked_by,operator_id FROM bookings WHERE instrument_id=$1 AND id<>$2 AND status IN ('requested','confirmed') AND reserved_start<$3::timestamptz+make_interval(mins=>$4) AND ends_at>now()`,
          [before.instrumentId, id, input.overrunUntil, before.cleanupMinutes],
        );
        await notify(
          tx,
          { ...before, version: before.version + 1 },
          "overrun affects the following reservation",
          affected.flatMap((b) => [b.booked_by, b.operator_id]),
        );
      }
      await tx.query(
        "UPDATE bookings SET status=$1,version=version+1,updated_at=now() WHERE id=$2",
        [status, id],
      );
      const after = await readBooking(tx, id);
      await audit(tx, u.id, `booking.${action}`, id, {
        before,
        after,
        reason: input.summary,
      });
      await notify(tx, after, action);
    });
    res.json(await readBooking(db, id));
  });
  async function unreadCount(tx: SQL, userId: string) {
    const [row] = await tx.query<{ count: string }>(
      `SELECT count(*) FROM notifications n WHERE ${notificationVisible} AND n.read_at IS NULL`,
      [userId],
    );
    return Number(row.count);
  }
  app.get("/api/notifications/summary", approved, async (_req, res) => {
    res.json({ unreadCount: await unreadCount(db, current(res).id) });
  });
  app.get("/api/notifications/page", approved, async (req, res) => {
    const input = z
      .object({
        before: z.string().uuid().optional(),
        unread: z.enum(["true", "false"]).default("false"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // Vercel's /api/:path* rewrite adds routing metadata to the query.
        // Accept only this known transport field; never use it as a filter.
        path: z.union([z.string(), z.array(z.string())]).optional(),
      })
      .strict()
      .parse(req.query);
    const userId = current(res).id;
    const page = await db.transaction(async (tx) => {
      await tx.exec(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      // Use the stored timestamp directly: converting microseconds to JS dates can skip rows.
      const rows = await tx.query<
        import("../shared/scheduling.js").Notification
      >(
        notificationSelect +
          ` WHERE ${notificationVisible}${input.unread === "true" ? " AND n.read_at IS NULL" : ""}
        ${input.before ? " AND (n.created_at,n.id)<(SELECT c.created_at,c.id FROM notifications c WHERE c.id=$2 AND c.user_id=$1)" : ""}
        ORDER BY n.created_at DESC,n.id DESC LIMIT $${input.before ? 3 : 2}`,
        input.before
          ? [userId, input.before, input.limit + 1]
          : [userId, input.limit + 1],
      );
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
        unreadCount: await unreadCount(tx, userId),
      };
    });
    res.json(page);
  });
  // Keep the original array response for older clients; the current UI uses /page.
  app.get("/api/notifications", approved, async (_req, res) =>
    res.json(
      await db.query(
        notificationSelect +
          ` WHERE ${notificationVisible} ORDER BY n.created_at DESC,n.id DESC LIMIT 200`,
        [current(res).id],
      ),
    ),
  );
  app.post("/api/notifications/:id/read", approved, async (req, res) => {
    const changed = await db.query(
      `UPDATE notifications n SET read_at=COALESCE(n.read_at,now()) WHERE ${notificationVisible} AND n.id=$2 RETURNING n.id`,
      [current(res).id, String(req.params.id)],
    );
    if (!changed.length) fail(404, "Notification not found.");
    res.json({ ok: true });
  });
}
