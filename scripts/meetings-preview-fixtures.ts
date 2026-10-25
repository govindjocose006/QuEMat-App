import { randomUUID } from "node:crypto";
import type { DB } from "../server/db.js";

// No accounts, credentials, roles or existing sample/booking/report records are changed.
// The caller first verifies explicit preview configuration and the stored preview marker.
export async function meetingsPreviewFixtures(db: DB) {
  await db.write(async (tx) => {
    if (
      (
        await tx.query(
          "SELECT id FROM users WHERE email NOT LIKE '%@example.test'",
        )
      ).length
    )
      throw new Error(
        "Meeting fixtures require an entirely synthetic preview database.",
      );
    if (
      !(
        await tx.query(
          "SELECT name FROM schema_migrations WHERE name='005_meetings_notices.sql'",
        )
      ).length
    )
      throw new Error("Apply preview migration 005 first.");
    const [manager] = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE email='weekly-preview-supervisor@example.test' AND status='approved' AND onboarded=1 AND app_role='supervisor'",
    );
    const [attendee] = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE email='weekly-preview-member@example.test' AND status='approved' AND onboarded=1",
    );
    if (!manager || !attendee)
      throw new Error(
        "Use the existing synthetic weekly supervisor/member accounts; do not reset or copy production accounts.",
      );
    const title = "Phase 3C synthetic preview meeting";
    if (
      !(
        await tx.query(
          "SELECT id FROM meetings WHERE title=$1 AND created_by=$2",
          [title, manager.id],
        )
      ).length
    ) {
      const id = randomUUID(),
        start = new Date(Date.now() + 86400000).toISOString(),
        end = new Date(Date.now() + 90000000).toISOString();
      await tx.query(
        "INSERT INTO meetings(id,title,kind,starts_at,ends_at,agenda,venue,created_by) VALUES($1,$2,'individual',$3,$4,'Synthetic discussion only; no physical instrument use.','Synthetic preview room',$5)",
        [id, title, start, end, manager.id],
      );
      await tx.query("INSERT INTO meeting_attendees VALUES($1,$2),($1,$3)", [
        id,
        attendee.id,
        manager.id,
      ]);
      const snapshot = {
        id,
        title,
        kind: "individual",
        startsAt: start,
        endsAt: end,
        agenda: "Synthetic discussion only; no physical instrument use.",
        venue: "Synthetic preview room",
        videoUrl: "",
        dataLinks: [],
        status: "scheduled",
        version: 1,
        createdBy: manager.id,
        createdName: "Weekly Preview Supervisor",
        attendeeIds: [attendee.id, manager.id],
        attendees: [
          { id: attendee.id, fullName: "Weekly Preview Mentee", active: true },
          {
            id: manager.id,
            fullName: "Weekly Preview Supervisor",
            active: true,
          },
        ],
      };
      await tx.query(
        "INSERT INTO meeting_events(id,meeting_id,actor_id,kind,after_state,version) VALUES($1,$2,$3,'created',$4::jsonb,1)",
        [randomUUID(), id, manager.id, JSON.stringify(snapshot)],
      );
      await tx.query(
        "INSERT INTO notifications(id,user_id,meeting_id,event_key,message) VALUES($1,$2,$3,$4,'A synthetic preview meeting was scheduled. Open it to view details.')",
        [randomUUID(), attendee.id, id, `meeting:${id}:version:1`],
      );
    }
    const noticeTitle = "Phase 3C synthetic preview notice";
    if (
      !(
        await tx.query(
          "SELECT id FROM notices WHERE title=$1 AND created_by=$2",
          [noticeTitle, manager.id],
        )
      ).length
    ) {
      const id = randomUUID(),
        body =
          "Synthetic preview only. Acknowledgement confirms reading, not approval or agreement.";
      await tx.query(
        "INSERT INTO notices(id,title,body,pinned,acknowledgement_required,status,published_at,created_by) VALUES($1,$2,$3,true,true,'published',now(),$4)",
        [id, noticeTitle, body, manager.id],
      );
      await tx.query(
        "INSERT INTO notice_events(id,notice_id,actor_id,kind,after_state,version) VALUES($1,$2,$3,'published',$4::jsonb,1)",
        [
          randomUUID(),
          id,
          manager.id,
          JSON.stringify({
            id,
            title: noticeTitle,
            body,
            status: "published",
            pinned: true,
            acknowledgementRequired: true,
            dataLinks: [],
          }),
        ],
      );
      await tx.query(
        "INSERT INTO notifications(id,user_id,notice_id,event_key,message) SELECT $1,id,$2,$3,'A synthetic preview notice was published. Explicit read acknowledgement is requested.' FROM users WHERE id=$4",
        [randomUUID(), id, `notice:${id}:version:1`, attendee.id],
      );
    }
  });
}
