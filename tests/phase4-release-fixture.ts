import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { DB, SQL } from "../server/db.js";
import { phase3bFixture } from "./phase3c-release-fixture.js";
export async function phase3cFixture(db: DB) {
  const fixture = await phase3bFixture(db);
  await db.exec(
    readFileSync("server/migrations/005_meetings_notices.sql", "utf8"),
  );
  await db.query(
    "INSERT INTO schema_migrations VALUES('005_meetings_notices.sql','synthetic-baseline')",
  );
  return {
    ...fixture,
    ...(await collaborationFixture(db, fixture.owner, fixture.reviewer)),
  };
}
export async function collaborationFixture(
  tx: SQL,
  owner: string,
  reviewer: string,
) {
  const meeting = randomUUID(),
    action = randomUUID(),
    notice = randomUUID();
  await tx.query(
    "INSERT INTO meetings(id,title,kind,starts_at,ends_at,created_by) VALUES($1,'Private synthetic retained meeting','individual','2026-10-20T10:00Z','2026-10-20T11:00Z',$2)",
    [meeting, owner],
  );
  await tx.query("INSERT INTO meeting_attendees VALUES($1,$2)", [
    meeting,
    reviewer,
  ]);
  await tx.query(
    "INSERT INTO meeting_events(id,meeting_id,actor_id,kind,after_state,version) VALUES($1,$2,$3,'created','{\"private\":\"Synthetic original meeting history\"}',1)",
    [randomUUID(), meeting, owner],
  );
  await tx.query(
    "INSERT INTO meeting_notes(id,meeting_id,author_id,body) VALUES($1,$2,$3,'Private synthetic retained notes')",
    [randomUUID(), meeting, owner],
  );
  await tx.query(
    "INSERT INTO meeting_actions(id,meeting_id,title,owner_id,status,version,completed_by,completed_at,created_by) VALUES($1,$2,'Retained synthetic action',$3,'done',2,$3,'2026-10-20T11:00Z',$4)",
    [action, meeting, reviewer, owner],
  );
  for (const [version, status] of [
    [1, "open"],
    [2, "done"],
  ])
    await tx.query(
      "INSERT INTO meeting_action_events(id,action_id,actor_id,status,version) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), action, reviewer, status, version],
    );
  await tx.query(
    "INSERT INTO notices(id,title,body,status,version,published_at,acknowledgement_required,created_by) VALUES($1,'Retained synthetic notice','Private synthetic notice correction','published',2,'2026-10-20T09:00Z',true,$2)",
    [notice, owner],
  );
  for (const version of [1, 2]) {
    await tx.query(
      "INSERT INTO notice_events(id,notice_id,actor_id,kind,after_state,version) VALUES($1,$2,$3,'published',$4::jsonb,$5)",
      [
        randomUUID(),
        notice,
        owner,
        JSON.stringify({ body: "Retained revision " + version }),
        version,
      ],
    );
    await tx.query(
      "INSERT INTO notice_acknowledgements(notice_id,user_id,version) VALUES($1,$2,$3)",
      [notice, reviewer, version],
    );
  }
  await tx.query(
    "INSERT INTO notifications(id,user_id,meeting_id,event_key,message) VALUES($1,$2,$3,'phase4-retain-meeting','Private synthetic meeting notification')",
    [randomUUID(), owner, meeting],
  );
  await tx.query(
    "INSERT INTO notifications(id,user_id,notice_id,event_key,message) VALUES($1,$2,$3,'phase4-retain-notice','Private synthetic notice notification')",
    [randomUUID(), reviewer, notice],
  );
  return { meeting, action, notice };
}
