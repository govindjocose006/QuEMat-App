import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, member, type DB, type SQL } from "./db.js";
import type { Member } from "../shared/schema.js";
import {
  collaborationVersion,
  meetingSchema,
  meetingUpdate,
  meetingCancel,
  meetingNote,
  meetingAction,
  meetingActionStatus,
  meetingManager,
  meetingCalendar,
  noticeSchema,
  noticeUpdate,
  noticeAcknowledgement,
  type Meeting,
  type MeetingDetail,
  type Notice,
  type NoticeDetail,
} from "../shared/meetings.js";

const meetingSelect = `SELECT m.id,m.title,m.kind,m.starts_at AS "startsAt",m.ends_at AS "endsAt",m.agenda,m.venue,m.video_url AS "videoUrl",m.data_links AS "dataLinks",m.status,m.version,m.created_by AS "createdBy",u.full_name AS "createdName",m.created_at AS "createdAt",m.updated_at AS "updatedAt",
 ARRAY(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id=m.id ORDER BY a.user_id) AS "attendeeIds",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'fullName',p.full_name,'active',p.status='approved' AND p.onboarded=1) ORDER BY p.full_name,p.id) FROM meeting_attendees a JOIN users p ON p.id=a.user_id WHERE a.meeting_id=m.id),'[]'::jsonb) AS attendees
 FROM meetings m JOIN users u ON u.id=m.created_by`;
const meetingScope =
  "($2::boolean OR EXISTS(SELECT 1 FROM meeting_attendees a WHERE a.meeting_id=m.id AND a.user_id=$1))";
const noticeSelect = `SELECT n.id,n.title,n.body,n.pinned,n.expires_at AS "expiresAt",n.acknowledgement_required AS "acknowledgementRequired",n.data_links AS "dataLinks",n.status,n.version,n.published_at AS "publishedAt",n.created_by AS "createdBy",u.full_name AS "createdName",n.created_at AS "createdAt",n.updated_at AS "updatedAt",(n.expires_at IS NOT NULL AND n.expires_at<=now()) AS expired,
 EXISTS(SELECT 1 FROM notice_acknowledgements a WHERE a.notice_id=n.id AND a.user_id=$1 AND a.version=n.version) AS acknowledged
 FROM notices n JOIN users u ON u.id=n.created_by`;
const actionSelect = `SELECT a.id,a.meeting_id AS "meetingId",a.title,a.owner_id AS "ownerId",u.full_name AS "ownerName",to_char(a.due_date,'YYYY-MM-DD') AS "dueDate",a.status,a.version,a.completed_by AS "completedBy",c.full_name AS "completedName",a.completed_at AS "completedAt" FROM meeting_actions a JOIN users u ON u.id=a.owner_id LEFT JOIN users c ON c.id=a.completed_by`;
const idSchema = z.string().uuid();
const meetingFilter = z.object({
  view: z.enum(["upcoming", "past", "cancelled", "all"]).default("upcoming"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const noticeFilter = z.object({
  view: z
    .enum(["current", "expired", "drafts", "withdrawn", "all"])
    .default("current"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export function installMeetings(
  app: Express,
  db: DB,
  approved: RequestHandler,
  current: (res: Response) => Member,
  fail: (status: number, message: string) => never,
) {
  async function actor(tx: SQL, res: Response) {
    const u = await member(tx, current(res).id);
    if (!u || u.status !== "approved" || !u.onboarded)
      fail(403, "Active approved membership is required.");
    return u;
  }
  function manager(u: Member) {
    if (!meetingManager(u.appRole))
      fail(
        403,
        "Application supervisor or administrator permission is required.",
      );
  }
  function version(actual: number, expected: number) {
    if (actual !== expected)
      fail(409, "This record changed. Reload before saving.");
  }
  async function meeting(tx: SQL, id: string, u: Member) {
    const [m] = await tx.query<Meeting>(
      meetingSelect + " WHERE m.id=$3 AND " + meetingScope,
      [u.id, meetingManager(u.appRole), id],
    );
    if (!m) fail(404, "Meeting not found or access unavailable.");
    return m;
  }
  async function notice(tx: SQL, id: string, u: Member) {
    const [n] = await tx.query<Notice>(
      noticeSelect + " WHERE n.id=$3 AND ($2::boolean OR n.status='published')",
      [u.id, meetingManager(u.appRole), id],
    );
    if (!n) fail(404, "Notice not found or access unavailable.");
    return n;
  }
  async function detail(
    tx: SQL,
    id: string,
    u: Member,
  ): Promise<MeetingDetail> {
    const m = await meeting(tx, id, u);
    const actions = await tx.query<MeetingDetail["actions"][number]>(
      actionSelect + " WHERE a.meeting_id=$1 ORDER BY a.created_at,a.id",
      [id],
    );
    const events = await tx.query<
      MeetingDetail["actions"][number]["events"][number] & { actionId: string }
    >(
      `SELECT e.id,e.action_id AS "actionId",p.full_name AS "actorName",e.status,e.version,e.created_at AS "createdAt" FROM meeting_action_events e JOIN users p ON p.id=e.actor_id JOIN meeting_actions a ON a.id=e.action_id WHERE a.meeting_id=$1 ORDER BY e.version`,
      [id],
    );
    return {
      ...m,
      events: await tx.query(
        `SELECT e.id,p.full_name AS "actorName",e.kind,e.reason,e.version,e.before_state AS before,e.after_state AS after,e.created_at AS "createdAt" FROM meeting_events e JOIN users p ON p.id=e.actor_id WHERE e.meeting_id=$1 ORDER BY e.version`,
        [id],
      ),
      notes: await tx.query(
        `SELECT n.id,p.full_name AS "authorName",n.body,n.data_links AS "dataLinks",n.created_at AS "createdAt" FROM meeting_notes n JOIN users p ON p.id=n.author_id WHERE n.meeting_id=$1 ORDER BY n.created_at,n.id`,
        [id],
      ),
      actions: actions.map((a) => ({
        ...a,
        events: events.filter((e) => e.actionId === a.id),
      })),
    };
  }
  async function noticeDetail(
    tx: SQL,
    id: string,
    u: Member,
  ): Promise<NoticeDetail> {
    const n = await notice(tx, id, u);
    return {
      ...n,
      events: await tx.query(
        `SELECT e.id,p.full_name AS "actorName",e.kind,e.version,e.after_state AS after,e.created_at AS "createdAt" FROM notice_events e JOIN users p ON p.id=e.actor_id WHERE e.notice_id=$1 AND ($2::boolean OR e.after_state->>'status'='published') ORDER BY e.version`,
        [id, meetingManager(u.appRole)],
      ),
      acknowledgements: await tx.query(
        `SELECT a.user_id AS "userId",p.full_name AS "fullName",a.version,a.created_at AS "createdAt" FROM notice_acknowledgements a JOIN users p ON p.id=a.user_id WHERE a.notice_id=$1 AND ($2::boolean OR a.user_id=$3) ORDER BY a.created_at,a.user_id`,
        [id, meetingManager(u.appRole), u.id],
      ),
    };
  }
  async function attendees(tx: SQL, ids: string[], before?: Meeting) {
    for (const id of ids) {
      if (before?.attendeeIds.includes(id)) continue;
      if (
        !(
          await tx.query(
            "SELECT id FROM users WHERE id=$1 AND status='approved' AND onboarded=1",
            [id],
          )
        ).length
      )
        fail(400, "Select active approved attendees.");
    }
    if (before) {
      const removed = before.attendeeIds.filter((id) => !ids.includes(id));
      if (
        removed.length &&
        (
          await tx.query(
            "SELECT id FROM meeting_actions WHERE meeting_id=$1 AND status='open' AND owner_id=ANY($2::text[])",
            [before.id, removed],
          )
        ).length
      )
        fail(
          400,
          "Complete open action items before removing their owner from this meeting.",
        );
    }
  }
  async function meetingEvent(
    tx: SQL,
    u: Member,
    m: Meeting,
    kind: string,
    reason = "",
    before: Meeting | null = null,
  ) {
    await tx.query(
      "INSERT INTO meeting_events(id,meeting_id,actor_id,kind,reason,before_state,after_state,version) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",
      [
        randomUUID(),
        m.id,
        u.id,
        kind,
        reason,
        before ? JSON.stringify(before) : null,
        JSON.stringify(m),
        m.version,
      ],
    );
    // Private details stay in the meeting's scoped history; audit records only identity/version.
    await audit(tx, u.id, `meeting.${kind}`, m.id, { version: m.version });
  }
  async function notify(
    tx: SQL,
    u: Member,
    source: "meeting" | "notice",
    id: string,
    event: string,
    recipients: string[],
    message: string,
  ) {
    for (const userId of new Set(recipients))
      if (userId !== u.id)
        await tx.query(
          `INSERT INTO notifications(id,user_id,${source}_id,event_key,message) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND status='approved' AND onboarded=1) ON CONFLICT(user_id,event_key) DO NOTHING`,
          [randomUUID(), userId, id, `${source}:${id}:${event}`, message],
        );
  }
  async function managers(tx: SQL) {
    return (
      await tx.query<{ id: string }>(
        "SELECT id FROM users WHERE status='approved' AND onboarded=1 AND app_role='administrator'",
      )
    ).map((p) => p.id);
  }
  async function meetingNotify(
    tx: SQL,
    u: Member,
    m: Meeting,
    key: string,
    verb: string,
    previous: string[] = [],
  ) {
    await notify(
      tx,
      u,
      "meeting",
      m.id,
      key,
      [...m.attendeeIds, ...previous, ...(await managers(tx))],
      `A meeting was ${verb}. Open it to view details if you still have access.`,
    );
  }
  async function noticeEvent(tx: SQL, u: Member, n: Notice, kind: string) {
    const { acknowledged: _acknowledged, ...snapshot } = n;
    await tx.query(
      "INSERT INTO notice_events(id,notice_id,actor_id,kind,after_state,version) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [randomUUID(), n.id, u.id, kind, JSON.stringify(snapshot), n.version],
    );
    await audit(tx, u.id, `notice.${kind}`, n.id, { version: n.version });
  }
  async function noticeNotify(tx: SQL, u: Member, n: Notice, verb: string) {
    const people = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE status='approved' AND onboarded=1",
    );
    await notify(
      tx,
      u,
      "notice",
      n.id,
      `version:${n.version}`,
      people.map((p) => p.id),
      `A notice was ${verb}.${n.status === "published" && !n.expired && n.acknowledgementRequired ? " Explicit read acknowledgement is requested on the notice." : ""}`,
    );
  }
  function expiry(value: string | null) {
    if (value && new Date(value).getTime() <= Date.now())
      fail(400, "Set a future expiry or leave it empty.");
  }
  app.get("/api/meetings/options", approved, async (_req, res) =>
    res.json(
      await db.query(
        `SELECT id,full_name AS "fullName",(status='approved' AND onboarded=1) AS active FROM users WHERE status='approved' AND onboarded=1 ORDER BY full_name,id`,
      ),
    ),
  );
  app.get("/api/collaboration/summary", approved, async (_req, res) => {
    const u = current(res);
    res.json(
      await db.transaction(async (tx) => ({
        meetings: await tx.query(
          meetingSelect +
            " WHERE " +
            meetingScope +
            " AND m.status='scheduled' AND m.ends_at>now() ORDER BY m.starts_at,m.id LIMIT 5",
          [u.id, meetingManager(u.appRole)],
        ),
        notices: await tx.query(
          noticeSelect +
            " WHERE n.status='published' AND n.pinned AND (n.expires_at IS NULL OR n.expires_at>now()) ORDER BY n.updated_at DESC,n.id LIMIT 5",
          [u.id],
        ),
        actions: await tx.query(
          actionSelect +
            ` JOIN meetings m ON m.id=a.meeting_id WHERE a.owner_id=$1 AND a.status='open' AND EXISTS(SELECT 1 FROM meeting_attendees p WHERE p.meeting_id=m.id AND p.user_id=$1) ORDER BY a.due_date NULLS LAST,a.created_at LIMIT 10`,
          [u.id],
        ),
      })),
    );
  });
  app.get("/api/meetings", approved, async (req, res) => {
    const { view, offset } = meetingFilter.parse(req.query),
      u = current(res);
    const predicate = {
      upcoming: "m.status='scheduled' AND m.ends_at>now()",
      past: "m.status='scheduled' AND m.ends_at<=now()",
      cancelled: "m.status='cancelled'",
      all: "true",
    }[view];
    const rows = await db.query(
      meetingSelect +
        ` WHERE ${meetingScope} AND ${predicate} ORDER BY m.starts_at,m.id LIMIT 51 OFFSET $3`,
      [u.id, meetingManager(u.appRole), offset],
    );
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post("/api/meetings", approved, async (req, res) => {
    const input = meetingSchema.parse(req.body);
    res.status(201).json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        await attendees(tx, input.attendeeIds);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO meetings(id,title,kind,starts_at,ends_at,agenda,venue,video_url,data_links,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)",
          [
            id,
            input.title,
            input.kind,
            input.startsAt,
            input.endsAt,
            input.agenda,
            input.venue,
            input.videoUrl,
            JSON.stringify(input.dataLinks),
            u.id,
          ],
        );
        for (const person of input.attendeeIds)
          await tx.query("INSERT INTO meeting_attendees VALUES($1,$2)", [
            id,
            person,
          ]);
        const m = await meeting(tx, id, u);
        await meetingEvent(tx, u, m, "created");
        await meetingNotify(tx, u, m, "version:1", "scheduled");
        return detail(tx, id, u);
      }),
    );
  });
  app.get("/api/meetings/:id/calendar", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      m = await meeting(db, id, current(res));
    res
      .type("text/calendar; charset=utf-8")
      .set(
        "Content-Disposition",
        `attachment; filename="quemat-meeting-${id}.ics"`,
      )
      .send(meetingCalendar(m));
  });
  app.get("/api/meetings/:id", approved, async (req, res) =>
    res.json(
      await db.transaction((tx) =>
        detail(tx, idSchema.parse(req.params.id), current(res)),
      ),
    ),
  );
  app.put("/api/meetings/:id", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = meetingUpdate.parse(req.body);
    res.json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        const before = await meeting(tx, id, u);
        version(before.version, input.version);
        if (before.status === "cancelled")
          fail(
            409,
            "Cancelled meetings are retained; schedule a new meeting instead.",
          );
        await attendees(tx, input.attendeeIds, before);
        await tx.query(
          "UPDATE meetings SET title=$2,kind=$3,starts_at=$4,ends_at=$5,agenda=$6,venue=$7,video_url=$8,data_links=$9::jsonb,version=version+1,updated_at=now() WHERE id=$1",
          [
            id,
            input.title,
            input.kind,
            input.startsAt,
            input.endsAt,
            input.agenda,
            input.venue,
            input.videoUrl,
            JSON.stringify(input.dataLinks),
          ],
        );
        await tx.query("DELETE FROM meeting_attendees WHERE meeting_id=$1", [
          id,
        ]);
        for (const person of input.attendeeIds)
          await tx.query("INSERT INTO meeting_attendees VALUES($1,$2)", [
            id,
            person,
          ]);
        const m = await meeting(tx, id, u);
        await meetingEvent(tx, u, m, "updated", input.reason, before);
        await meetingNotify(
          tx,
          u,
          m,
          `version:${m.version}`,
          "updated or rescheduled",
          before.attendeeIds,
        );
        return detail(tx, id, u);
      }),
    );
  });
  app.post("/api/meetings/:id/cancel", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = meetingCancel.parse(req.body);
    res.json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        const before = await meeting(tx, id, u);
        version(before.version, input.version);
        if (before.status === "cancelled")
          fail(409, "This meeting is already cancelled.");
        await tx.query(
          "UPDATE meetings SET status='cancelled',version=version+1,updated_at=now() WHERE id=$1",
          [id],
        );
        const m = await meeting(tx, id, u);
        await meetingEvent(tx, u, m, "cancelled", input.reason, before);
        await meetingNotify(tx, u, m, `version:${m.version}`, "cancelled");
        return detail(tx, id, u);
      }),
    );
  });
  app.post("/api/meetings/:id/notes", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = meetingNote.parse(req.body);
    res.status(201).json(
      await db.write(async (tx) => {
        const u = await actor(tx, res),
          m = await meeting(tx, id, u),
          noteId = randomUUID();
        await tx.query(
          "INSERT INTO meeting_notes(id,meeting_id,author_id,body,data_links) VALUES($1,$2,$3,$4,$5::jsonb)",
          [noteId, id, u.id, input.body, JSON.stringify(input.dataLinks)],
        );
        await audit(tx, u.id, "meeting.note", id, { noteId });
        await meetingNotify(tx, u, m, `note:${noteId}`, "given a new note");
        return detail(tx, id, u);
      }),
    );
  });
  app.post("/api/meetings/:id/actions", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = meetingAction.parse(req.body);
    res.status(201).json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        const m = await meeting(tx, id, u);
        if (m.status === "cancelled")
          fail(409, "Do not add new actions to a cancelled meeting.");
        if (
          !m.attendeeIds.includes(input.ownerId) ||
          !(
            await tx.query(
              "SELECT id FROM users WHERE id=$1 AND status='approved' AND onboarded=1",
              [input.ownerId],
            )
          ).length
        )
          fail(400, "Action owner must be an active approved attendee.");
        const actionId = randomUUID();
        await tx.query(
          "INSERT INTO meeting_actions(id,meeting_id,title,owner_id,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [actionId, id, input.title, input.ownerId, input.dueDate, u.id],
        );
        await tx.query(
          "INSERT INTO meeting_action_events(id,action_id,actor_id,status,version) VALUES($1,$2,$3,'open',1)",
          [randomUUID(), actionId, u.id],
        );
        await audit(tx, u.id, "meeting.action.assigned", id, { actionId });
        await meetingNotify(
          tx,
          u,
          m,
          `action:${actionId}:1`,
          "given an action item",
        );
        return detail(tx, id, u);
      }),
    );
  });
  app.post(
    "/api/meetings/:id/actions/:actionId",
    approved,
    async (req, res) => {
      const id = idSchema.parse(req.params.id),
        actionId = idSchema.parse(req.params.actionId),
        input = meetingActionStatus.parse(req.body);
      res.json(
        await db.write(async (tx) => {
          const u = await actor(tx, res),
            m = await meeting(tx, id, u);
          const [a] = await tx.query<{
            owner_id: string;
            version: number;
            status: string;
          }>(
            "SELECT owner_id,version,status FROM meeting_actions WHERE id=$1 AND meeting_id=$2",
            [actionId, id],
          );
          if (!a) fail(404, "Action item not found.");
          if (a.owner_id !== u.id && !meetingManager(u.appRole))
            fail(
              403,
              "Only the action owner or a meeting manager can change completion.",
            );
          version(a.version, input.version);
          if (a.status === input.status)
            fail(409, "This action already has that status.");
          if (
            input.status === "open" &&
            (!m.attendeeIds.includes(a.owner_id) ||
              !(
                await tx.query(
                  "SELECT id FROM users WHERE id=$1 AND status='approved' AND onboarded=1",
                  [a.owner_id],
                )
              ).length)
          )
            fail(
              400,
              "Restore the active action owner as a selected attendee before reopening.",
            );
          await tx.query(
            "UPDATE meeting_actions SET status=$2,version=version+1,completed_by=$3,completed_at=CASE WHEN $2='done' THEN now() ELSE NULL END WHERE id=$1",
            [actionId, input.status, input.status === "done" ? u.id : null],
          );
          await tx.query(
            "INSERT INTO meeting_action_events(id,action_id,actor_id,status,version) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), actionId, u.id, input.status, a.version + 1],
          );
          await audit(tx, u.id, "meeting.action.status", id, {
            actionId,
            status: input.status,
          });
          await meetingNotify(
            tx,
            u,
            m,
            `action:${actionId}:${a.version + 1}`,
            "given an action completion update",
          );
          return detail(tx, id, u);
        }),
      );
    },
  );
  app.get("/api/notices", approved, async (req, res) => {
    const { view, offset } = noticeFilter.parse(req.query),
      u = current(res),
      staff = meetingManager(u.appRole);
    if (["drafts", "withdrawn"].includes(view)) manager(u);
    const predicate = {
      current:
        "n.status='published' AND (n.expires_at IS NULL OR n.expires_at>now())",
      expired: "n.status='published' AND n.expires_at<=now()",
      drafts: "n.status='draft'",
      withdrawn: "n.status='withdrawn'",
      all: staff ? "true" : "n.status='published'",
    }[view];
    const rows = await db.query(
      noticeSelect +
        ` WHERE ${predicate} ORDER BY n.pinned DESC,n.updated_at DESC,n.id LIMIT 51 OFFSET $2`,
      [u.id, offset],
    );
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post("/api/notices", approved, async (req, res) => {
    const input = noticeSchema.parse(req.body);
    res.status(201).json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        expiry(input.expiresAt);
        const id = randomUUID();
        await tx.query(
          "INSERT INTO notices(id,title,body,pinned,expires_at,acknowledgement_required,data_links,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
          [
            id,
            input.title,
            input.body,
            input.pinned,
            input.expiresAt,
            input.acknowledgementRequired,
            JSON.stringify(input.dataLinks),
            u.id,
          ],
        );
        const n = await notice(tx, id, u);
        await noticeEvent(tx, u, n, "created");
        return noticeDetail(tx, id, u);
      }),
    );
  });
  app.get("/api/notices/:id", approved, async (req, res) =>
    res.json(
      await db.transaction((tx) =>
        noticeDetail(tx, idSchema.parse(req.params.id), current(res)),
      ),
    ),
  );
  app.put("/api/notices/:id", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = noticeUpdate.parse(req.body);
    res.json(
      await db.write(async (tx) => {
        const u = await actor(tx, res);
        manager(u);
        const before = await notice(tx, id, u);
        version(before.version, input.version);
        expiry(input.expiresAt);
        await tx.query(
          "UPDATE notices SET title=$2,body=$3,pinned=$4,expires_at=$5,acknowledgement_required=$6,data_links=$7::jsonb,version=version+1,updated_at=now() WHERE id=$1",
          [
            id,
            input.title,
            input.body,
            input.pinned,
            input.expiresAt,
            input.acknowledgementRequired,
            JSON.stringify(input.dataLinks),
          ],
        );
        const n = await notice(tx, id, u);
        await noticeEvent(tx, u, n, "updated");
        if (n.status === "published") await noticeNotify(tx, u, n, "updated");
        return noticeDetail(tx, id, u);
      }),
    );
  });
  for (const operation of ["publish", "withdraw"] as const)
    app.post(`/api/notices/:id/${operation}`, approved, async (req, res) => {
      const id = idSchema.parse(req.params.id),
        input = collaborationVersion.parse(req.body);
      res.json(
        await db.write(async (tx) => {
          const u = await actor(tx, res);
          manager(u);
          const before = await notice(tx, id, u);
          version(before.version, input.version);
          const status = operation === "publish" ? "published" : "withdrawn";
          if (before.status === status)
            fail(409, "This notice already has that status.");
          if (operation === "publish") expiry(before.expiresAt);
          await tx.query(
            "UPDATE notices SET status=$2,version=version+1,updated_at=now(),published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=$1",
            [id, status],
          );
          const n = await notice(tx, id, u);
          await noticeEvent(tx, u, n, status);
          if (n.status === "published" || before.status === "published")
            await noticeNotify(tx, u, n, status);
          return noticeDetail(tx, id, u);
        }),
      );
    });
  app.post("/api/notices/:id/acknowledge", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id),
      input = noticeAcknowledgement.parse(req.body);
    res.json(
      await db.write(async (tx) => {
        const u = await actor(tx, res),
          n = await notice(tx, id, u);
        version(n.version, input.version);
        if (n.status !== "published" || n.expired || !n.acknowledgementRequired)
          fail(409, "Read acknowledgement is unavailable for this notice.");
        const added = await tx.query(
          "INSERT INTO notice_acknowledgements(notice_id,user_id,version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING notice_id",
          [id, u.id, n.version],
        );
        if (added.length) {
          await audit(tx, u.id, "notice.read-acknowledged", id, {
            version: n.version,
          });
          await notify(
            tx,
            u,
            "notice",
            id,
            `read:${u.id}:${n.version}`,
            await managers(tx),
            "A member explicitly confirmed reading a notice. This is not approval of its contents.",
          );
        }
        return noticeDetail(tx, id, u);
      }),
    );
  });
}
