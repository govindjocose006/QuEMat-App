import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DB, SQL } from "../server/db.js";
import { phase3aFixture } from "./phase3b-release-fixture.js";

export async function phase3bFixture(db: DB) {
  const fixture = await phase3aFixture(db);
  await db.exec(
    readFileSync("server/migrations/004_issues_requests.sql", "utf8"),
  );
  await db.query(
    "INSERT INTO schema_migrations VALUES('004_issues_requests.sql','synthetic-only-baseline')",
  );
  const issues = await addIssueFixture(
    db,
    fixture.owner,
    fixture.reviewer,
    fixture.report,
  );
  return { ...fixture, ...issues };
}
export async function addIssueFixture(
  tx: SQL,
  owner: string,
  reviewer: string,
  _report?: string,
) {
  const issueIds: string[] = [],
    eventIds: string[] = [],
    issueComments: string[] = [];
  for (const status of ["open", "acknowledged", "resolved"]) {
    const id = randomUUID();
    issueIds.push(id);
    const version = status === "open" ? 1 : status === "acknowledged" ? 2 : 3;
    await tx.query(
      "INSERT INTO issues(id,reporter_id,assignee_id,title,description,category,priority,status,version,acknowledged_by,acknowledged_at,resolved_by,resolved_at) VALUES($1,$2,$3,$4,'Retain synthetic description and data links','general_decision','normal',$5,$6,$7,$8,$9,$10)",
      [
        id,
        owner,
        reviewer,
        `Synthetic retained ${status} issue`,
        status,
        version,
        status === "open" ? null : reviewer,
        status === "open" ? null : "2026-10-24T12:00:00Z",
        status === "resolved" ? reviewer : null,
        status === "resolved" ? "2026-10-24T13:00:00Z" : null,
      ],
    );
    for (let n = 1; n <= version; n++) {
      const eventId = randomUUID();
      eventIds.push(eventId);
      const next = n === 1 ? "open" : n === 2 ? "acknowledged" : "resolved";
      await tx.query(
        "INSERT INTO issue_events(id,issue_id,actor_id,kind,from_status,to_status,reason,before_state,after_state,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)",
        [
          eventId,
          id,
          n === 1 ? owner : reviewer,
          n === 1 ? "created" : "status",
          n === 1 ? null : n === 2 ? "open" : "acknowledged",
          next,
          n === 2 ? "" : "Synthetic retained decision",
          n === 1
            ? null
            : JSON.stringify({ id, status: n === 2 ? "open" : "acknowledged" }),
          JSON.stringify({
            id,
            status: next,
            title: `Synthetic retained ${status} issue`,
          }),
          n,
        ],
      );
    }
    const comment = randomUUID();
    issueComments.push(comment);
    await tx.query(
      'INSERT INTO issue_comments(id,issue_id,author_id,body,data_links) VALUES($1,$2,$3,\'Retain synthetic issue discussion\',\'[{"label":"Retained evidence","url":"https://example.test/private-issue"}]\')',
      [comment, id, owner],
    );
    await tx.query(
      "INSERT INTO notifications(id,user_id,issue_id,event_key,message) VALUES($1,$2,$3,$4,'Retain issue notification')",
      [randomUUID(), owner, id, `release3c:${id}`],
    );
  }
  return { issueIds, eventIds, issueComments };
}
