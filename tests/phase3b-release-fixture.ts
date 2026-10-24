// Only synthetic data in an explicitly supplied isolated test SQL database.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { seed, type DB, type SQL } from "../server/db.js";
export async function phase3aFixture(db: DB) {
  await db.exec(
    "CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE write_lock(id INTEGER PRIMARY KEY);INSERT INTO write_lock VALUES(1)",
  );
  for (const name of [
    "001_foundation.sql",
    "002_scheduling.sql",
    "003_weekly_progress.sql",
  ]) {
    await db.exec(readFileSync("server/migrations/" + name, "utf8"));
    await db.query(
      "INSERT INTO schema_migrations VALUES($1,'synthetic-only-baseline')",
      [name],
    );
  }
  await seed(db);
  return addWeeklyFixture(db);
}
export async function addWeeklyFixture(
  db: SQL,
  existingOwner?: string,
  existingInstrument?: string,
) {
  const owner = existingOwner ?? randomUUID(),
    reviewer = randomUUID(),
    report = randomUUID(),
    comment = randomUUID(),
    sample = randomUUID(),
    past = randomUUID(),
    furnaceBooking = randomUUID();
  if (!existingOwner)
    await db.query(
      "INSERT INTO users(id,email,password_hash,full_name,status,onboarded,app_role,academic_role,created_at) VALUES($1,'release3b@example.test','synthetic-hash','Synthetic retained administrator','approved',1,'administrator','PhD student','2020-01-01T00:00:00Z')",
      [owner],
    );
  await db.query(
    "INSERT INTO users(id,email,password_hash,full_name,status,onboarded,app_role,academic_role,created_at) VALUES($1,'release3b-supervisor@example.test','synthetic-hash','Synthetic retained reviewer','approved',1,'supervisor','Supervisor','2020-01-01T00:00:00Z')",
    [reviewer],
  );
  const instrument =
    existingInstrument ??
    (
      await db.query<{ id: string }>(
        "SELECT id FROM instruments WHERE seed_key='initial-0'",
      )
    )[0].id;
  const furnace = (
    await db.query<{ id: string }>(
      "SELECT id FROM instruments WHERE category='Furnace' ORDER BY id LIMIT 1",
    )
  )[0].id;
  await db.query(
    "INSERT INTO sop_links(instrument_id,label,url) VALUES($1,'Synthetic retained SOP','https://example.test/private-sop')",
    [instrument],
  );
  await db.query(
    "INSERT INTO samples(id,owner_id,compound,origin,notes,archived) VALUES($1,$2,'Synthetic retained FeSe','internal','Preserve archived sample notes',true)",
    [sample, owner],
  );
  await db.query(
    "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,actual_start,actual_end,completion_summary,handover_notes) VALUES($1,$2,$3,$3,'booking','completed','2026-10-21T10:00Z','2026-10-21T11:00Z','Synthetic retained M(T)','2026-10-21T10:05Z','2026-10-21T10:55Z','Retain actual result','Retain handover')",
    [past, instrument, owner],
  );
  await db.query(
    "INSERT INTO bookings(id,instrument_id,booked_by,operator_id,kind,status,starts_at,ends_at,measurement_type,actual_start,details,unloaded) VALUES($1,$2,$3,$3,'booking','in_progress','2032-01-01T10:00Z','2032-01-01T12:00Z','Synthetic retained furnace run','2032-01-01T10:05Z','{\"targetTemperatureC\":500}',false)",
    [furnaceBooking, furnace, owner],
  );
  await db.query("INSERT INTO booking_samples VALUES($1,$2),($3,$2)", [
    past,
    sample,
    furnaceBooking,
  ]);
  await db.query(
    "INSERT INTO availability_windows(id,instrument_id,starts_at,ends_at,reference,created_by) VALUES($1,$2,'2033-02-01T00:00Z','2033-02-02T00:00Z','Retain allocation',$3)",
    [randomUUID(), instrument, owner],
  );
  await db.query(
    "INSERT INTO weekly_reports(id,owner_id,week_start,draft,has_draft,latest_revision,first_submitted_at) VALUES($1,$2,'2026-10-19','{\"results\":\"Private synthetic revision draft\"}',true,2,'2026-10-23T15:00Z')",
    [report, owner],
  );
  for (const revision of [1, 2])
    await db.query(
      "INSERT INTO weekly_revisions(report_id,revision,content,submitted_at) VALUES($1,$2,$3::jsonb,$4::timestamptz)",
      [
        report,
        revision,
        JSON.stringify({
          results: `Synthetic original result ${revision}`,
          bookings: [{ id: past, actualEnd: "2026-10-21T10:55:00Z" }],
          samples: [{ id: sample, compound: "Synthetic FeSe" }],
        }),
        revision === 1 ? "2026-10-23T15:00Z" : "2026-10-24T10:00Z",
      ],
    );
  await db.query(
    "INSERT INTO weekly_comments(id,report_id,revision,author_id,body,kind,due_date) VALUES($1,$2,2,$3,'Retain synthetic follow-up text','followup','2026-11-02')",
    [comment, report, reviewer],
  );
  await db.query(
    "INSERT INTO weekly_reviews(report_id,revision,reviewer_id) VALUES($1,1,$2),($1,2,$2)",
    [report, reviewer],
  );
  await db.query(
    "INSERT INTO weekly_action_events(id,comment_id,actor_id,state) VALUES($1,$2,$3,'open')",
    [randomUUID(), comment, reviewer],
  );
  await db.query(
    "INSERT INTO notifications(id,user_id,booking_id,event_key,message,read_at) VALUES($1,$2,$3,'release3b-booking','Retain booking notification','2026-10-21T12:00Z')",
    [randomUUID(), owner, past],
  );
  await db.query(
    "INSERT INTO notifications(id,user_id,weekly_report_id,event_key,message) VALUES($1,$2,$3,'release3b-weekly','Retain weekly notification')",
    [randomUUID(), owner, report],
  );
  await db.query(
    "INSERT INTO audit_events(id,actor_id,action,entity_id,details,created_at) VALUES($1,$2,'synthetic.original',$3,'Retain immutable audit','2026-10-23T15:00Z')",
    [randomUUID(), owner, report],
  );
  await db.query(
    "INSERT INTO sessions VALUES('release3b-synthetic-session',$1,'synthetic-csrf',123456789)",
    [owner],
  );
  await db.query(
    "INSERT INTO rate_limits VALUES('release3b-synthetic-client',2,123456789)",
  );
  return {
    owner,
    reviewer,
    report,
    comment,
    sample,
    past,
    instrument,
    furnaceBooking,
  };
}
