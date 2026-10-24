import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, member, type DB, type SQL } from "./db.js";
import type { Member } from "../shared/schema.js";
import {
  issueSchema,
  issueUpdate,
  issueAction,
  issueComment,
  issueStatuses,
  issuePriorities,
  issueCategories,
  issueManager,
  canDiscussIssue,
  canEditIssue,
  availableIssueActions,
  type Issue,
  type IssueInput,
} from "../shared/issues.js";
const select = `SELECT i.id,i.code,i.reporter_id AS "reporterId",r.full_name AS "reporterName",i.assignee_id AS "assigneeId",a.full_name AS "assigneeName",
 i.title,i.description,i.category,i.priority,to_char(i.due_date,'YYYY-MM-DD') AS "dueDate",i.instrument_id AS "instrumentId",n.name AS "instrumentName",i.sample_id AS "sampleId",s.code AS "sampleCode",s.compound AS "sampleCompound",i.project,i.supervisor_attention AS "supervisorAttention",i.data_links AS "dataLinks",i.status,i.version,
 i.acknowledged_by AS "acknowledgedBy",k.full_name AS "acknowledgedName",i.acknowledged_at AS "acknowledgedAt",i.resolved_by AS "resolvedBy",v.full_name AS "resolvedName",i.resolved_at AS "resolvedAt",i.created_at AS "createdAt",i.updated_at AS "updatedAt"
 FROM issues i JOIN users r ON r.id=i.reporter_id LEFT JOIN users a ON a.id=i.assignee_id LEFT JOIN instruments n ON n.id=i.instrument_id LEFT JOIN samples s ON s.id=i.sample_id LEFT JOIN users k ON k.id=i.acknowledged_by LEFT JOIN users v ON v.id=i.resolved_by`;
const filters = z.object({
  view: z.enum(["work", "resolved", "all"]).default("work"),
  status: z.enum(issueStatuses).optional(),
  priority: z.enum(issuePriorities).optional(),
  category: issueSchema.shape.category.optional(),
  instrument: z.string().uuid().optional(),
  assignee: z
    .union([z.literal("me"), z.literal("unassigned"), z.string().uuid()])
    .optional(),
  q: z.string().trim().max(200).default(""),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export function installIssues(
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
  async function row(tx: SQL, id: string) {
    const r = (await tx.query<Issue>(select + " WHERE i.id=$1", [id]))[0];
    if (!r) fail(404, "Issue/request not found.");
    return r;
  }
  function version(r: Issue, n: number) {
    if (r.version !== n)
      fail(409, "This item changed. Reload before saving or changing status.");
  }
  async function references(tx: SQL, input: IssueInput, before?: Issue) {
    if (
      input.assigneeId &&
      input.assigneeId !== before?.assigneeId &&
      !(
        await tx.query(
          "SELECT id FROM users WHERE id=$1 AND status='approved' AND onboarded=1",
          [input.assigneeId],
        )
      ).length
    )
      fail(400, "Select an active approved assignee.");
    if (
      input.instrumentId &&
      input.instrumentId !== before?.instrumentId &&
      !(
        await tx.query(
          "SELECT id FROM instruments WHERE id=$1 AND archived=0",
          [input.instrumentId],
        )
      ).length
    )
      fail(400, "Select an active instrument.");
    if (
      input.sampleId &&
      input.sampleId !== before?.sampleId &&
      !(
        await tx.query(
          "SELECT id FROM samples WHERE id=$1 AND archived=false",
          [input.sampleId],
        )
      ).length
    )
      fail(400, "Select an active sample.");
  }
  async function detail(tx: SQL, id: string) {
    return {
      ...(await row(tx, id)),
      events: await tx.query(
        `SELECT e.id,e.actor_id AS "actorId",u.full_name AS "actorName",e.kind,e.from_status AS "fromStatus",e.to_status AS "toStatus",e.reason,e.before_state AS before,e.after_state AS after,e.created_at AS "createdAt" FROM issue_events e JOIN users u ON u.id=e.actor_id WHERE e.issue_id=$1 ORDER BY e.version`,
        [id],
      ),
      comments: await tx.query(
        `SELECT c.id,c.author_id AS "authorId",u.full_name AS "authorName",c.body,c.data_links AS "dataLinks",c.created_at AS "createdAt" FROM issue_comments c JOIN users u ON u.id=c.author_id WHERE c.issue_id=$1 ORDER BY c.created_at,c.id`,
        [id],
      ),
    };
  }
  async function event(
    tx: SQL,
    u: Member,
    after: Issue,
    kind: string,
    reason: string,
    before: Issue | null = null,
  ) {
    await tx.query(
      "INSERT INTO issue_events(id,issue_id,actor_id,kind,from_status,to_status,reason,before_state,after_state,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)",
      [
        randomUUID(),
        after.id,
        u.id,
        kind,
        before?.status ?? null,
        after.status,
        reason,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
        after.version,
      ],
    );
    await audit(tx, u.id, `issue.${kind}`, after.id, { before, after, reason });
  }
  async function notify(
    tx: SQL,
    u: Member,
    r: Issue,
    verb: string,
    key: string,
    before?: Issue,
  ) {
    const ids = new Set(
      [r.reporterId, r.assigneeId, before?.assigneeId].filter(
        (x): x is string => !!x,
      ),
    );
    if (r.supervisorAttention || before?.supervisorAttention)
      for (const p of await tx.query<{ id: string }>(
        "SELECT id FROM users WHERE status='approved' AND onboarded=1 AND app_role IN ('supervisor','administrator')",
      ))
        ids.add(p.id);
    const attention = r.supervisorAttention
      ? r.acknowledgedBy
        ? " Supervisor attention requested; see recorded acknowledgement."
        : " Supervisor attention requested; not yet acknowledged."
      : before?.supervisorAttention
        ? " Supervisor attention request cleared."
        : "";
    for (const id of ids)
      if (id !== u.id)
        await tx.query(
          "INSERT INTO notifications(id,user_id,issue_id,event_key,message) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND status='approved' AND onboarded=1) ON CONFLICT(user_id,event_key) DO NOTHING",
          [
            randomUUID(),
            id,
            r.id,
            `issue:${r.id}:${key}`,
            `${r.code}: ${verb}. ${r.title}.${attention}`,
          ],
        );
  }
  app.get("/api/issues/options", approved, async (_req, res) =>
    res.json({
      people: await db.query(
        "SELECT id,full_name AS \"fullName\",(status='approved' AND onboarded=1) AS active FROM users WHERE (status='approved' AND onboarded=1) OR id IN (SELECT assignee_id FROM issues) ORDER BY full_name,id",
      ),
      instruments: await db.query(
        "SELECT id,name,(archived=1) AS archived FROM instruments ORDER BY sort_order,name",
      ),
      samples: await db.query(
        "SELECT id,code,compound,archived FROM samples ORDER BY created_at DESC",
      ),
    }),
  );
  app.get("/api/issues/summary", approved, async (_req, res) => {
    const u = current(res),
      staff = issueManager(u.appRole);
    const predicates = {
      urgent: "i.status<>'resolved' AND i.priority='urgent'",
      assigned: "i.status<>'resolved' AND i.assignee_id=$1",
      supervisor: staff
        ? "i.status<>'resolved' AND i.supervisor_attention=true"
        : "false",
    };
    const result: Record<string, unknown> = {},
      counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      for (const [key, where] of Object.entries(predicates)) {
        const values = key === "assigned" ? [u.id] : [];
        result[key] = await tx.query(
          select +
            " WHERE " +
            where +
            " ORDER BY i.updated_at DESC,i.id LIMIT 5",
          values,
        );
        const [n] = await tx.query<{ count: string }>(
          "SELECT count(*) FROM issues i WHERE " + where,
          values,
        );
        counts[key] = Number(n.count);
      }
    });
    res.json({ ...result, counts });
  });
  app.get("/api/issues", approved, async (req, res) => {
    const f = filters.parse(req.query),
      where: string[] = [],
      values: unknown[] = [];
    const bind = (v: unknown) => {
      values.push(v);
      return "$" + values.length;
    };
    if (f.view === "work") where.push("i.status<>'resolved'");
    if (f.view === "resolved") where.push("i.status='resolved'");
    for (const [key, value] of Object.entries({
      status: f.status,
      priority: f.priority,
      category: f.category,
      instrument_id: f.instrument,
    }))
      if (value) where.push(`i.${key}=${bind(value)}`);
    if (f.assignee === "unassigned") where.push("i.assignee_id IS NULL");
    else if (f.assignee)
      where.push(
        "i.assignee_id=" +
          bind(f.assignee === "me" ? current(res).id : f.assignee),
      );
    if (f.q) {
      const p = bind("%" + f.q.replace(/[\\%_]/g, "\\$&") + "%");
      where.push(
        `(i.code ILIKE ${p} OR i.title ILIKE ${p} OR i.description ILIKE ${p} OR i.project ILIKE ${p} OR r.full_name ILIKE ${p} OR a.full_name ILIKE ${p} OR n.name ILIKE ${p} OR s.code ILIKE ${p})`,
      );
    }
    const sql = select + (where.length ? " WHERE " + where.join(" AND ") : "");
    const [n] = await db.query<{ count: string }>(
      "SELECT count(*) FROM (" + sql + ") q",
      values,
    );
    res.json({
      items: await db.query(
        sql +
          ` ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,i.due_date ASC NULLS LAST,i.updated_at DESC,i.id LIMIT 50 OFFSET ${bind(f.offset)}`,
        values,
      ),
      total: Number(n.count),
    });
  });
  app.post("/api/issues", approved, async (req, res) => {
    const input = issueSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res);
      await references(tx, input);
      await tx.query(
        `INSERT INTO issues(id,reporter_id,title,description,category,priority,due_date,instrument_id,sample_id,project,assignee_id,supervisor_attention,data_links) VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          id,
          u.id,
          input.title,
          input.description,
          input.category,
          input.priority,
          input.dueDate,
          input.instrumentId,
          input.sampleId,
          input.project,
          input.assigneeId,
          input.supervisorAttention,
          JSON.stringify(input.dataLinks),
        ],
      );
      const r = await row(tx, id);
      await event(tx, u, r, "created", "Reported; no acknowledgement implied.");
      await notify(tx, u, r, "reported", "1:created");
    });
    res.status(201).json(await detail(db, id));
  });
  app.get("/api/issues/:id", approved, async (req, res) =>
    res.json(await detail(db, String(req.params.id))),
  );
  app.put("/api/issues/:id", approved, async (req, res) => {
    const input = issueUpdate.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        before = await row(tx, id);
      version(before, input.version);
      if (!canEditIssue(u, before))
        fail(
          403,
          "Only the reporter, supervisor or administrator can edit details or assignment.",
        );
      await references(tx, input, before);
      await tx.query(
        `UPDATE issues SET title=$1,description=$2,category=$3,priority=$4,due_date=$5::date,instrument_id=$6,sample_id=$7,project=$8,assignee_id=$9,supervisor_attention=$10,data_links=$11::jsonb,version=version+1,updated_at=now() WHERE id=$12`,
        [
          input.title,
          input.description,
          input.category,
          input.priority,
          input.dueDate,
          input.instrumentId,
          input.sampleId,
          input.project,
          input.assigneeId,
          input.supervisorAttention,
          JSON.stringify(input.dataLinks),
          id,
        ],
      );
      const after = await row(tx, id);
      await event(
        tx,
        u,
        after,
        "updated",
        "Details / assignment updated.",
        before,
      );
      await notify(
        tx,
        u,
        after,
        "details / assignment updated",
        `${after.version}:updated`,
        before,
      );
    });
    res.json(await detail(db, id));
  });
  app.post("/api/issues/:id/status", approved, async (req, res) => {
    const input = issueAction.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        before = await row(tx, id);
      version(before, input.version);
      if (!availableIssueActions(u, before).includes(input.status))
        fail(
          403,
          "This status change is not allowed. Acknowledge first; only the assignee or a lab manager can advance work. Participants may reopen a resolved item.",
        );
      await tx.query(
        `UPDATE issues SET status=$1,version=version+1,updated_at=now(),acknowledged_by=CASE WHEN $1='acknowledged' THEN COALESCE(acknowledged_by,$2) ELSE acknowledged_by END,acknowledged_at=CASE WHEN $1='acknowledged' THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,resolved_by=CASE WHEN $1='resolved' THEN $2 ELSE resolved_by END,resolved_at=CASE WHEN $1='resolved' THEN now() ELSE resolved_at END WHERE id=$3`,
        [input.status, u.id, id],
      );
      const after = await row(tx, id);
      await event(tx, u, after, "status", input.reason, before);
      await notify(
        tx,
        u,
        after,
        `status: ${input.status.replaceAll("_", " ")}`,
        `${after.version}:status`,
      );
    });
    res.json(await detail(db, id));
  });
  app.post("/api/issues/:id/comments", approved, async (req, res) => {
    const input = issueComment.parse(req.body),
      id = String(req.params.id),
      commentId = randomUUID();
    await db.write(async (tx) => {
      const u = await actor(tx, res),
        r = await row(tx, id);
      if (!canDiscussIssue(u, r))
        fail(
          403,
          "Only the reporter, assignee, supervisor or administrator can discuss this item.",
        );
      await tx.query(
        "INSERT INTO issue_comments(id,issue_id,author_id,body,data_links) VALUES($1,$2,$3,$4,$5::jsonb)",
        [commentId, id, u.id, input.body, JSON.stringify(input.dataLinks)],
      );
      await audit(tx, u.id, "issue.comment_added", id, { commentId });
      await notify(tx, u, r, "comment added", `comment:${commentId}`);
    });
    res.status(201).json(await detail(db, id));
  });
}
