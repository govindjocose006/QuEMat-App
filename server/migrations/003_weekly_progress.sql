CREATE TABLE weekly_reports (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  week_start DATE NOT NULL CHECK(extract(isodow FROM week_start)=1),
  draft JSONB NOT NULL, has_draft BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  latest_revision INTEGER NOT NULL DEFAULT 0 CHECK(latest_revision>=0),
  first_submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id,week_start)
);
CREATE TABLE weekly_revisions (
  report_id TEXT NOT NULL REFERENCES weekly_reports(id), revision INTEGER NOT NULL CHECK(revision>0),
  content JSONB NOT NULL, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(report_id,revision)
);
CREATE TABLE weekly_comments (
  id TEXT PRIMARY KEY, report_id TEXT NOT NULL, revision INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL CHECK(length(body)>0),
  kind TEXT NOT NULL CHECK(kind IN ('comment','followup')), due_date DATE,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','done')),
  version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(report_id,revision) REFERENCES weekly_revisions(report_id,revision),
  CHECK(kind='followup' OR (due_date IS NULL AND state='open'))
);
CREATE TABLE weekly_reviews (
  report_id TEXT NOT NULL, revision INTEGER NOT NULL, reviewer_id TEXT NOT NULL REFERENCES users(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(report_id,revision,reviewer_id),
  FOREIGN KEY(report_id,revision) REFERENCES weekly_revisions(report_id,revision)
);
CREATE TABLE weekly_action_events (
  id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES weekly_comments(id),
  actor_id TEXT NOT NULL REFERENCES users(id), state TEXT NOT NULL CHECK(state IN ('open','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_weekly_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Weekly submission and review history is append only'; END;
$$;
CREATE TRIGGER weekly_revisions_immutable BEFORE UPDATE OR DELETE ON weekly_revisions FOR EACH ROW EXECUTE FUNCTION protect_weekly_history();
CREATE TRIGGER weekly_reviews_immutable BEFORE UPDATE OR DELETE ON weekly_reviews FOR EACH ROW EXECUTE FUNCTION protect_weekly_history();
CREATE TRIGGER weekly_actions_immutable BEFORE UPDATE OR DELETE ON weekly_action_events FOR EACH ROW EXECUTE FUNCTION protect_weekly_history();
CREATE FUNCTION protect_weekly_comment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Weekly comments are retained'; END IF;
  IF (NEW.id,NEW.report_id,NEW.revision,NEW.author_id,NEW.body,NEW.kind,NEW.due_date,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.report_id,OLD.revision,OLD.author_id,OLD.body,OLD.kind,OLD.due_date,OLD.created_at)
  THEN RAISE EXCEPTION 'Weekly comment content is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER weekly_comments_immutable BEFORE UPDATE OR DELETE ON weekly_comments FOR EACH ROW EXECUTE FUNCTION protect_weekly_comment();
CREATE INDEX weekly_reports_week ON weekly_reports(week_start);
CREATE INDEX weekly_comments_report ON weekly_comments(report_id,created_at);
ALTER TABLE notifications ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN weekly_report_id TEXT REFERENCES weekly_reports(id);
ALTER TABLE notifications ADD CONSTRAINT notification_source CHECK ((booking_id IS NOT NULL AND weekly_report_id IS NULL) OR (booking_id IS NULL AND weekly_report_id IS NOT NULL));
