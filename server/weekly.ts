import type { Express, RequestHandler, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, member, type DB, type SQL } from "./db.js";
import type { Member } from "../shared/schema.js";
import {
  reportSchema,
  reportFields,
  weekSchema,
  weekStart,
  weekBounds,
  reviewsAll,
  canOpenReview,
  type ReportInput,
  type ReportContent,
  type WeeklyBooking,
  type WeeklySample,
  type WeeklyRevision,
  type WeeklyRoster,
} from "../shared/weekly.js";

type Row = {
  id: string;
  ownerId: string;
  ownerName: string;
  week: string;
  draft: ReportInput;
  hasDraft: boolean;
  version: number;
  latestRevision: number;
  firstSubmittedAt: string | null;
};
const select = `SELECT r.id,r.owner_id AS "ownerId",u.full_name AS "ownerName",to_char(r.week_start,'YYYY-MM-DD') AS week,r.draft,r.has_draft AS "hasDraft",r.version,r.latest_revision AS "latestRevision",r.first_submitted_at AS "firstSubmittedAt" FROM weekly_reports r JOIN users u ON u.id=r.owner_id`;
const comments = `SELECT c.id,c.revision,u.full_name AS "authorName",c.body,c.kind,to_char(c.due_date,'YYYY-MM-DD') AS "dueDate",c.state,c.version,c.created_at AS "createdAt" FROM weekly_comments c JOIN users u ON u.id=c.author_id WHERE c.report_id=$1 ORDER BY c.created_at,c.id`;
const expectedVersion = z.object({ version: z.number().int().positive() });
const digest = (content: ReportContent) =>
  createHash("sha256").update(JSON.stringify(content)).digest("hex");

export function installWeekly(
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
  async function reviewer(_tx: SQL, u: Member, ownerId: string) {
    return u.id !== ownerId && reviewsAll(u.appRole);
  }
  async function row(tx: SQL, id: string) {
    const r = (await tx.query<Row>(select + " WHERE r.id=$1", [id]))[0];
    if (!r) fail(404, "Weekly report not found.");
    return r;
  }
  async function access(tx: SQL, u: Member, r: Row) {
    if (
      r.ownerId !== u.id &&
      (!r.latestRevision || !(await reviewer(tx, u, r.ownerId)))
    )
      fail(404, "Weekly report not found.");
  }
  function version(r: Row, n: number) {
    if (r.version !== n)
      fail(409, "This report changed. Reload before saving or submitting.");
  }
  async function sources(tx: SQL, ownerId: string, week: string) {
    const [from, to] = weekBounds(week);
    const bookings = await tx.query<WeeklyBooking>(
      `SELECT b.id,i.name AS "instrumentName",b.measurement_type AS "measurementType",u.full_name AS "operatorName",b.status,b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.actual_start AS "actualStart",b.actual_end AS "actualEnd",b.completion_summary AS "completionSummary",b.data_link AS "dataLink",b.sample_snapshots AS "sampleSnapshots"
      FROM bookings b JOIN instruments i ON i.id=b.instrument_id JOIN users u ON u.id=b.operator_id
      WHERE b.kind='booking' AND (b.booked_by=$1 OR b.operator_id=$1 OR b.participants @> $4::jsonb)
      AND ((b.starts_at<$3::timestamptz AND b.ends_at>$2::timestamptz) OR (b.actual_start<$3::timestamptz AND COALESCE(b.actual_end,now())>$2::timestamptz)) ORDER BY b.starts_at,b.id`,
      [ownerId, from, to, JSON.stringify([{ id: ownerId }])],
    );
    const samples = await tx.query<WeeklySample>(
      `SELECT id,code,compound,batch,project,archived FROM samples WHERE owner_id=$1 OR id IN (SELECT sample_id FROM booking_samples WHERE booking_id=ANY($2::text[])) ORDER BY code`,
      [ownerId, bookings.map((b) => b.id)],
    );
    return { bookings, samples };
  }
  async function content(tx: SQL, r: Row): Promise<ReportContent> {
    const available = await sources(tx, r.ownerId, r.week);
    const chosen = <T extends { id: string }>(ids: string[], items: T[]) => {
      if (new Set(ids).size !== ids.length)
        fail(400, "Choose each linked record only once.");
      return ids.map((id) => {
        const found = items.find((x) => x.id === id);
        if (!found)
          fail(
            400,
            "A selected booking or sample is no longer relevant to you and this week. Update the selection.",
          );
        return found;
      });
    };
    return JSON.parse(
      JSON.stringify({
        ...r.draft,
        bookings: chosen(r.draft.bookingIds, available.bookings),
        samples: chosen(r.draft.sampleIds, available.samples),
      }),
    );
  }
  async function detail(tx: SQL, u: Member, r: Row) {
    await access(tx, u, r);
    const { draft, hasDraft, ...publicRow } = r;
    return {
      ...publicRow,
      ...(r.ownerId === u.id ? { draft, hasDraft } : {}),
      canReview: await reviewer(tx, u, r.ownerId),
      revisions: await tx.query<WeeklyRevision>(
        'SELECT revision,content,submitted_at AS "submittedAt" FROM weekly_revisions WHERE report_id=$1 ORDER BY revision DESC',
        [r.id],
      ),
      comments: await tx.query(comments, [r.id]),
      reviews: await tx.query(
        'SELECT r.revision,u.full_name AS "reviewerName",r.reviewed_at AS "reviewedAt" FROM weekly_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.report_id=$1 ORDER BY r.reviewed_at',
        [r.id],
      ),
      actionEvents: await tx.query(
        'SELECT e.comment_id AS "commentId",u.full_name AS "actorName",e.state,e.created_at AS "createdAt" FROM weekly_action_events e JOIN weekly_comments c ON c.id=e.comment_id JOIN users u ON u.id=e.actor_id WHERE c.report_id=$1 ORDER BY e.created_at,e.id',
        [r.id],
      ),
    };
  }
  async function notify(tx: SQL, r: Row, u: Member, event: string) {
    const people = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE status='approved' AND onboarded=1 AND id=$1`,
      [r.ownerId],
    );
    for (const { id } of people)
      if (id !== u.id)
        await tx.query(
          "INSERT INTO notifications(id,user_id,weekly_report_id,event_key,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING",
          [
            randomUUID(),
            id,
            r.id,
            `weekly:${r.id}:${event}`,
            `Weekly progress · week of ${r.week} · ${r.ownerName}: ${event.split(":")[0]}.`,
          ],
        );
  }
  async function roster(
    tx: SQL,
    u: Member,
    week: string,
    person?: string,
    project?: string,
  ) {
    if (!canOpenReview(u.appRole))
      fail(
        403,
        "Only the supervisor can review other members’ weekly reports.",
      );
    const [, end] = weekBounds(week);
    const people = await tx.query<{
      id: string;
      fullName: string;
      project: string;
      active: boolean;
      eligible: boolean;
    }>(
      `SELECT u.id,u.full_name AS "fullName",u.project,(u.status='approved' AND u.onboarded=1) AS active,
      (u.status='approved' AND u.onboarded=1 AND u.app_role IN ('member','mentor') AND u.created_at::timestamptz<$3::timestamptz) AS eligible
      FROM users u WHERE ($1::boolean OR u.mentor_id=$2) AND
      ((u.status='approved' AND u.onboarded=1 AND u.app_role IN ('member','mentor') AND u.created_at::timestamptz<$3::timestamptz)
       OR EXISTS(SELECT 1 FROM weekly_reports r WHERE r.owner_id=u.id AND r.week_start=$4::date AND r.latest_revision>0)) ORDER BY u.full_name,u.id`,
      [reviewsAll(u.appRole), u.id, end, week],
    );
    const list: WeeklyRoster[] = [];
    for (const p of people) {
      if (person && p.id !== person) continue;
      const r = (
        await tx.query<Row>(
          select +
            " WHERE r.owner_id=$1 AND r.week_start=$2::date AND r.latest_revision>0",
          [p.id, week],
        )
      )[0];
      const rev = r
        ? (
            await tx.query<WeeklyRevision>(
              'SELECT revision,content,submitted_at AS "submittedAt" FROM weekly_revisions WHERE report_id=$1 AND revision=$2',
              [r.id, r.latestRevision],
            )
          )[0]
        : null;
      const effectiveProject = rev?.content.project ?? p.project;
      if (
        project &&
        !effectiveProject.toLowerCase().includes(project.toLowerCase())
      )
        continue;
      list.push({
        ...p,
        project: effectiveProject,
        status: r ? "submitted" : p.eligible ? "missing" : "optional",
        reportId: r?.id ?? null,
        revision: r?.latestRevision ?? 0,
        reviewed: r
          ? !!(
              await tx.query(
                "SELECT 1 FROM weekly_reviews WHERE report_id=$1 AND revision=$2",
                [r.id, r.latestRevision],
              )
            ).length
          : false,
        content: rev?.content ?? null,
        submittedAt: rev?.submittedAt ?? null,
        comments: r ? await tx.query(comments, [r.id]) : [],
      });
    }
    return list;
  }
  app.get("/api/weekly/sources", approved, async (req, res) =>
    res.json(
      await sources(db, current(res).id, weekSchema.parse(req.query.week)),
    ),
  );
  app.get("/api/weekly/mine", approved, async (req, res) => {
    const week = weekSchema.parse(req.query.week);
    const r = (
      await db.query<Row>(
        select + " WHERE r.owner_id=$1 AND r.week_start=$2::date",
        [current(res).id, week],
      )
    )[0];
    res.json(r ? await detail(db, current(res), r) : null);
  });
  app.get("/api/weekly/review", approved, async (req, res) =>
    res.json(
      await roster(
        db,
        current(res),
        weekSchema.parse(req.query.week),
        z.string().uuid().optional().parse(req.query.person),
        z.string().max(500).optional().parse(req.query.project),
      ),
    ),
  );
  app.get("/api/weekly/summary", approved, async (_req, res) => {
    const u = current(res),
      week = weekStart();
    const r = (
      await db.query<Row>(
        select + " WHERE r.owner_id=$1 AND r.week_start=$2::date",
        [u.id, week],
      )
    )[0];
    const entries = canOpenReview(u.appRole) ? await roster(db, u, week) : [];
    const [actions] = await db.query<{ count: string }>(
      "SELECT count(*) FROM weekly_comments c JOIN weekly_reports r ON r.id=c.report_id WHERE r.owner_id=$1 AND c.kind='followup' AND c.state='open'",
      [u.id],
    );
    res.json({
      week,
      mine: r
        ? r.hasDraft
          ? r.latestRevision
            ? "Revision draft"
            : "Draft"
          : "Submitted"
        : "Not submitted",
      openActions: Number(actions.count),
      review: canOpenReview(u.appRole)
        ? {
            submitted: entries.filter((x) => x.status === "submitted").length,
            missing: entries.filter((x) => x.status === "missing").length,
            awaitingReview: entries.filter(
              (x) => x.status === "submitted" && !x.reviewed,
            ).length,
          }
        : null,
    });
  });
  app.post("/api/weekly/reports", approved, async (req, res) => {
    const input = z
        .object({ week: weekSchema, content: reportSchema })
        .parse(req.body),
      id = randomUUID();
    if (input.week > weekStart())
      fail(
        400,
        "Reports can be written for the current week or an earlier week.",
      );
    await db.write(async (tx) => {
      const u = await actor(tx, res);
      if (
        (
          await tx.query(
            "SELECT 1 FROM weekly_reports WHERE owner_id=$1 AND week_start=$2::date",
            [u.id, input.week],
          )
        ).length
      )
        fail(409, "You already have a report for this week. Open it to edit.");
      await tx.query(
        "INSERT INTO weekly_reports(id,owner_id,week_start,draft) VALUES($1,$2,$3,$4::jsonb)",
        [id, u.id, input.week, JSON.stringify(input.content)],
      );
      await content(tx, await row(tx, id));
      await audit(tx, u.id, "weekly.draft_created", id, { week: input.week });
    });
    res.status(201).json(await detail(db, current(res), await row(db, id)));
  });
  app.get("/api/weekly/reports/:id", approved, async (req, res) =>
    res.json(
      await detail(db, current(res), await row(db, String(req.params.id))),
    ),
  );
  app.put("/api/weekly/reports/:id", approved, async (req, res) => {
    const input = expectedVersion
        .extend({ content: reportSchema })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        r = await row(tx, id);
      if (r.ownerId !== u.id)
        fail(403, "Only the author can edit this report.");
      version(r, input.version);
      await content(tx, { ...r, draft: input.content });
      await tx.query(
        "UPDATE weekly_reports SET draft=$1::jsonb,has_draft=true,version=version+1,updated_at=now() WHERE id=$2",
        [JSON.stringify(input.content), id],
      );
      await audit(tx, u.id, "weekly.draft_saved", id, {
        version: r.version + 1,
      });
    });
    res.json(await detail(db, current(res), await row(db, id)));
  });
  app.post("/api/weekly/reports/:id/preview", approved, async (req, res) => {
    const input = expectedVersion.parse(req.body);
    res.json(
      await db.write(async (tx) => {
        const u = await actor(tx, res),
          r = await row(tx, String(req.params.id));
        if (r.ownerId !== u.id)
          fail(403, "Only the author can prepare a submission.");
        version(r, input.version);
        if (!r.hasDraft)
          fail(409, "Save a revision draft before submitting again.");
        const c = await content(tx, r);
        for (const key of Object.keys(
          reportFields,
        ) as (keyof typeof reportFields)[])
          if (!c[key])
            fail(
              400,
              `Complete “${reportFields[key]}”; write “None” when appropriate.`,
            );
        return { version: r.version, content: c, reviewDigest: digest(c) };
      }),
    );
  });
  app.post("/api/weekly/reports/:id/submit", approved, async (req, res) => {
    const input = expectedVersion
        .extend({ reviewDigest: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        r = await row(tx, id);
      if (r.ownerId !== u.id)
        fail(403, "Only the author can submit this report.");
      version(r, input.version);
      if (!r.hasDraft) fail(409, "This draft has already been submitted.");
      const c = await content(tx, r);
      for (const key of Object.keys(
        reportFields,
      ) as (keyof typeof reportFields)[])
        if (!c[key]) fail(400, `Complete “${reportFields[key]}”.`);
      if (digest(c) !== input.reviewDigest)
        fail(
          409,
          "Linked content changed. Review the updated submission before confirming.",
        );
      await tx.query(
        "INSERT INTO weekly_revisions(report_id,revision,content) VALUES($1,$2,$3::jsonb)",
        [id, r.latestRevision + 1, JSON.stringify(c)],
      );
      await tx.query(
        "UPDATE weekly_reports SET latest_revision=latest_revision+1,first_submitted_at=COALESCE(first_submitted_at,now()),has_draft=false,version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      await audit(tx, u.id, "weekly.submitted", id, {
        revision: r.latestRevision + 1,
        week: r.week,
      });
      await notify(tx, r, u, `submitted:${r.latestRevision + 1}`);
    });
    res.json(await detail(db, current(res), await row(db, id)));
  });
  app.post("/api/weekly/reports/:id/comments", approved, async (req, res) => {
    const input = z
        .object({
          revision: z.number().int().positive(),
          kind: z.enum(["comment", "followup"]),
          body: z.string().trim().min(1).max(4000),
          dueDate: z.iso.date().nullable().default(null),
        })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        r = await row(tx, id);
      await access(tx, u, r);
      const review = await reviewer(tx, u, r.ownerId);
      if (input.kind === "followup" && !review)
        fail(403, "Only a reviewer can assign a report follow-up.");
      if (input.kind === "comment" && input.dueDate)
        fail(400, "Due dates apply to follow-up actions.");
      if (input.revision > r.latestRevision)
        fail(400, "Select a submitted revision.");
      const commentId = randomUUID();
      await tx.query(
        "INSERT INTO weekly_comments(id,report_id,revision,author_id,body,kind,due_date) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          commentId,
          id,
          input.revision,
          u.id,
          input.body,
          input.kind,
          input.dueDate,
        ],
      );
      if (input.kind === "followup")
        await tx.query(
          "INSERT INTO weekly_action_events(id,comment_id,actor_id,state) VALUES($1,$2,$3,'open')",
          [randomUUID(), commentId, u.id],
        );
      await audit(tx, u.id, "weekly.comment_added", id, {
        commentId,
        revision: input.revision,
        kind: input.kind,
      });
      await notify(tx, r, u, `${input.kind}:` + commentId);
    });
    res.json(await detail(db, current(res), await row(db, id)));
  });
  app.post("/api/weekly/reports/:id/review", approved, async (req, res) => {
    const { revision } = z
        .object({ revision: z.number().int().positive() })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        r = await row(tx, id);
      if (!(await reviewer(tx, u, r.ownerId)))
        fail(
          403,
          "Review permission is required; authors cannot review themselves.",
        );
      if (revision > r.latestRevision)
        fail(400, "Select a submitted revision.");
      const inserted = await tx.query(
        "INSERT INTO weekly_reviews(report_id,revision,reviewer_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING report_id",
        [id, revision, u.id],
      );
      if (inserted.length) {
        await audit(tx, u.id, "weekly.reviewed", id, { revision });
        await notify(tx, r, u, `reviewed:${revision}:${u.id}`);
      }
    });
    res.json(await detail(db, current(res), await row(db, id)));
  });
  app.post(
    "/api/weekly/reports/:id/actions/:actionId",
    approved,
    async (req, res) => {
      const input = expectedVersion
          .extend({ state: z.enum(["open", "done"]) })
          .parse(req.body),
        id = String(req.params.id),
        actionId = String(req.params.actionId);
      await db.write(async (tx) => {
        const u = await actor(tx, res),
          r = await row(tx, id);
        await access(tx, u, r);
        const [c] = await tx.query<{ version: number; state: string }>(
          "SELECT version,state FROM weekly_comments WHERE id=$1 AND report_id=$2 AND kind='followup'",
          [actionId, id],
        );
        if (!c) fail(404, "Follow-up action not found.");
        if (c.version !== input.version)
          fail(409, "This action changed. Reload before updating.");
        if (c.state === input.state) return;
        await tx.query(
          "UPDATE weekly_comments SET state=$1,version=version+1 WHERE id=$2",
          [input.state, actionId],
        );
        await tx.query(
          "INSERT INTO weekly_action_events(id,comment_id,actor_id,state) VALUES($1,$2,$3,$4)",
          [randomUUID(), actionId, u.id, input.state],
        );
        await audit(tx, u.id, "weekly.action_updated", id, {
          actionId,
          state: input.state,
        });
        await notify(
          tx,
          r,
          u,
          `follow-up ${input.state}:${actionId}:${c.version + 1}`,
        );
      });
      res.json(await detail(db, current(res), await row(db, id)));
    },
  );
}
