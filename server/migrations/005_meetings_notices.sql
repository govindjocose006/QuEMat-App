CREATE TABLE meetings (
 id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 180),
 kind TEXT NOT NULL CHECK(kind IN ('group','individual')), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at),
 agenda TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', data_links JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(data_links)='array'),
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled')), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE meeting_attendees (meeting_id TEXT NOT NULL REFERENCES meetings(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(meeting_id,user_id));
CREATE TABLE meeting_events (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('created','updated','cancelled')), reason TEXT NOT NULL DEFAULT '', before_state JSONB, after_state JSONB NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(meeting_id,version)
);
CREATE TABLE meeting_notes (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), author_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 8000), data_links JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(data_links)='array'), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE meeting_actions (
 id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id), title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 500),
 owner_id TEXT NOT NULL REFERENCES users(id), due_date DATE, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), completed_by TEXT REFERENCES users(id), completed_at TIMESTAMPTZ,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((status='done' AND completed_by IS NOT NULL AND completed_at IS NOT NULL) OR (status='open' AND completed_by IS NULL AND completed_at IS NULL))
);
CREATE TABLE meeting_action_events (
 id TEXT PRIMARY KEY, action_id TEXT NOT NULL REFERENCES meeting_actions(id), actor_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('open','done')), version INTEGER NOT NULL CHECK(version>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(action_id,version)
);
CREATE TABLE notices (
 id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 180), body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 12000),
 pinned BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMPTZ, acknowledgement_required BOOLEAN NOT NULL DEFAULT false,
 data_links JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(data_links)='array'), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), published_at TIMESTAMPTZ,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(status<>'published' OR published_at IS NOT NULL)
);
CREATE TABLE notice_events (
 id TEXT PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES notices(id), actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('created','updated','published','withdrawn')), after_state JSONB NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(notice_id,version)
);
CREATE TABLE notice_acknowledgements (
 notice_id TEXT NOT NULL REFERENCES notices(id), user_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(notice_id,user_id,version), FOREIGN KEY(notice_id,version) REFERENCES notice_events(notice_id,version)
);
CREATE FUNCTION protect_collaboration_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Meeting and notice history is append only'; END;
$$;
CREATE TRIGGER meeting_events_immutable BEFORE UPDATE OR DELETE ON meeting_events FOR EACH ROW EXECUTE FUNCTION protect_collaboration_history();
CREATE TRIGGER meeting_notes_immutable BEFORE UPDATE OR DELETE ON meeting_notes FOR EACH ROW EXECUTE FUNCTION protect_collaboration_history();
CREATE TRIGGER meeting_action_events_immutable BEFORE UPDATE OR DELETE ON meeting_action_events FOR EACH ROW EXECUTE FUNCTION protect_collaboration_history();
CREATE TRIGGER notice_events_immutable BEFORE UPDATE OR DELETE ON notice_events FOR EACH ROW EXECUTE FUNCTION protect_collaboration_history();
CREATE TRIGGER notice_acknowledgements_immutable BEFORE UPDATE OR DELETE ON notice_acknowledgements FOR EACH ROW EXECUTE FUNCTION protect_collaboration_history();
CREATE FUNCTION protect_collaboration_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Meeting and notice records are retained'; END IF;
 IF (NEW.id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Meeting and notice identity is immutable'; END IF;
 IF TG_TABLE_NAME='meeting_actions' THEN
  IF NEW.meeting_id IS DISTINCT FROM OLD.meeting_id THEN RAISE EXCEPTION 'Action meeting is immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER meetings_identity BEFORE UPDATE OR DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION protect_collaboration_identity();
CREATE TRIGGER notices_identity BEFORE UPDATE OR DELETE ON notices FOR EACH ROW EXECUTE FUNCTION protect_collaboration_identity();
CREATE TRIGGER meeting_actions_identity BEFORE UPDATE OR DELETE ON meeting_actions FOR EACH ROW EXECUTE FUNCTION protect_collaboration_identity();
CREATE INDEX meetings_upcoming ON meetings(status,starts_at);
CREATE INDEX meeting_attendees_person ON meeting_attendees(user_id,meeting_id);
CREATE INDEX meeting_notes_meeting ON meeting_notes(meeting_id,created_at);
CREATE INDEX meeting_actions_owner ON meeting_actions(owner_id,status);
CREATE INDEX notices_published ON notices(status,pinned,expires_at);
ALTER TABLE notifications ADD COLUMN meeting_id TEXT REFERENCES meetings(id);
ALTER TABLE notifications ADD COLUMN notice_id TEXT REFERENCES notices(id);
ALTER TABLE notifications DROP CONSTRAINT notification_source;
ALTER TABLE notifications ADD CONSTRAINT notification_source CHECK(num_nonnulls(booking_id,weekly_report_id,issue_id,meeting_id,notice_id)=1);
