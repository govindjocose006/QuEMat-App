CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK(email = lower(email)),
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  academic_role TEXT CHECK(academic_role IN ('PhD student','Postdoc','Master’s student','Intern','Supervisor')),
  project TEXT NOT NULL DEFAULT '',
  mentor_id TEXT REFERENCES users(id),
  mentor_pending INTEGER NOT NULL DEFAULT 0 CHECK(mentor_pending IN (0,1)),
  app_role TEXT NOT NULL DEFAULT 'member' CHECK(app_role IN ('member','mentor','supervisor','administrator')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','inactive')),
  onboarded INTEGER NOT NULL DEFAULT 0 CHECK(onboarded IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK(mentor_id IS NULL OR mentor_id <> id),
  CHECK(status <> 'approved' OR onboarded=1)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE instruments (
  id TEXT PRIMARY KEY, seed_key TEXT UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('available','maintenance','out of service')),
  priority INTEGER NOT NULL CHECK(priority IN (0,1)),
  max_temperature_c DOUBLE PRECISION CHECK(max_temperature_c>0),
  booking_rules TEXT NOT NULL DEFAULT '',
  scheduling_mode TEXT NOT NULL CHECK(scheduling_mode IN ('internal','allocated')),
  coordinator_approval INTEGER NOT NULL CHECK(coordinator_approval IN (0,1)),
  setup_minutes INTEGER NOT NULL CHECK(setup_minutes>=0), cleanup_minutes INTEGER NOT NULL CHECK(cleanup_minutes>=0),
  training_policy TEXT NOT NULL DEFAULT '', training_note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 100,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE training_entries (
  id BIGSERIAL PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id), name TEXT NOT NULL,
  member_id TEXT REFERENCES users(id), UNIQUE(instrument_id,name)
);
CREATE TABLE sop_links (
  id BIGSERIAL PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id), label TEXT NOT NULL, url TEXT NOT NULL
);
CREATE TABLE audit_events (
  sequence BIGSERIAL UNIQUE, id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  entity_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX audit_time ON audit_events(created_at);
CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append only'; END;
$$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);
