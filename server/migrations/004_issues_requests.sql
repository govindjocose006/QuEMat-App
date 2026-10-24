CREATE SEQUENCE issue_number;
CREATE TABLE issues (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE DEFAULT ('ISS-' || nextval('issue_number')),
  reporter_id TEXT NOT NULL REFERENCES users(id), assignee_id TEXT REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 180),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 5 AND 8000),
  category TEXT NOT NULL CHECK(category IN ('helium_refill','instrument_malfunction','consumables_maintenance','proposal_writing','purchase_approval','measurement_assistance','general_decision')),
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  due_date DATE, instrument_id TEXT REFERENCES instruments(id), sample_id TEXT REFERENCES samples(id),
  project TEXT NOT NULL DEFAULT '', supervisor_attention BOOLEAN NOT NULL DEFAULT false,
  data_links JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(data_links)='array'),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','blocked','resolved')),
  acknowledged_by TEXT REFERENCES users(id), acknowledged_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES users(id), resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((acknowledged_by IS NULL)=(acknowledged_at IS NULL)),
  CHECK((resolved_by IS NULL)=(resolved_at IS NULL)),
  CHECK(status='open' OR acknowledged_by IS NOT NULL),
  CHECK(status<>'resolved' OR resolved_by IS NOT NULL)
);
CREATE TABLE issue_events (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('created','updated','status')),
  from_status TEXT CHECK(from_status IN ('open','acknowledged','in_progress','blocked','resolved')),
  to_status TEXT NOT NULL CHECK(to_status IN ('open','acknowledged','in_progress','blocked','resolved')),
  reason TEXT NOT NULL, before_state JSONB, after_state JSONB NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), UNIQUE(issue_id,version),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE issue_comments (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id), author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),
  data_links JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(data_links)='array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_issue_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Issue history and comments are append only'; END;
$$;
CREATE TRIGGER issue_events_immutable BEFORE UPDATE OR DELETE ON issue_events FOR EACH ROW EXECUTE FUNCTION protect_issue_history();
CREATE TRIGGER issue_comments_immutable BEFORE UPDATE OR DELETE ON issue_comments FOR EACH ROW EXECUTE FUNCTION protect_issue_history();
CREATE FUNCTION protect_issue_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issues are retained; resolve instead'; END IF;
  IF (NEW.id,NEW.code,NEW.reporter_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.code,OLD.reporter_id,OLD.created_at)
  THEN RAISE EXCEPTION 'Issue identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issues_identity BEFORE UPDATE OR DELETE ON issues FOR EACH ROW EXECUTE FUNCTION protect_issue_identity();
CREATE INDEX issues_work ON issues(status,priority,updated_at DESC);
CREATE INDEX issues_assignee ON issues(assignee_id,status);
CREATE INDEX issues_instrument ON issues(instrument_id,status);
CREATE INDEX issue_events_issue ON issue_events(issue_id,created_at);
CREATE INDEX issue_comments_issue ON issue_comments(issue_id,created_at);
ALTER TABLE notifications ADD COLUMN issue_id TEXT REFERENCES issues(id);
ALTER TABLE notifications DROP CONSTRAINT notification_source;
ALTER TABLE notifications ADD CONSTRAINT notification_source CHECK (
  (booking_id IS NOT NULL AND weekly_report_id IS NULL AND issue_id IS NULL) OR
  (booking_id IS NULL AND weekly_report_id IS NOT NULL AND issue_id IS NULL) OR
  (booking_id IS NULL AND weekly_report_id IS NULL AND issue_id IS NOT NULL)
);
