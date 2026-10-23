CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SEQUENCE sample_number;
CREATE TABLE samples (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE DEFAULT ('QEM-' || nextval('sample_number')::text),
  owner_id TEXT NOT NULL REFERENCES users(id),
  compound TEXT NOT NULL CHECK(length(compound)>0),
  project TEXT NOT NULL DEFAULT '', batch TEXT NOT NULL DEFAULT '',
  prepared_on DATE, origin TEXT NOT NULL CHECK(origin IN ('internal','external')),
  physical_form TEXT NOT NULL DEFAULT '', quantity TEXT NOT NULL DEFAULT '',
  storage TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  archived BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE availability_windows (
  id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  reference TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
  CHECK(ends_at>starts_at)
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL REFERENCES instruments(id),
  booked_by TEXT NOT NULL REFERENCES users(id), operator_id TEXT REFERENCES users(id),
  instrument_category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('booking','maintenance')),
  status TEXT NOT NULL CHECK(status IN ('requested','confirmed','in_progress','completed','cancelled','interrupted','rejected')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  setup_minutes INTEGER NOT NULL DEFAULT 0, cleanup_minutes INTEGER NOT NULL DEFAULT 0,
  reserved_start TIMESTAMPTZ NOT NULL, reserved_end TIMESTAMPTZ NOT NULL,
  measurement_type TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
  sample_snapshots JSONB NOT NULL DEFAULT '[]', participants JSONB NOT NULL DEFAULT '[]',
  details JSONB NOT NULL DEFAULT '{}', setup_notes TEXT NOT NULL DEFAULT '',
  allocation_reference TEXT NOT NULL DEFAULT '',
  actual_start TIMESTAMPTZ, actual_end TIMESTAMPTZ, unloaded BOOLEAN NOT NULL DEFAULT false,
  completion_summary TEXT NOT NULL DEFAULT '', data_link TEXT NOT NULL DEFAULT '',
  handover_notes TEXT NOT NULL DEFAULT '', overrun_until TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(ends_at>starts_at), CHECK(reserved_end>reserved_start),
  CHECK(kind='maintenance' OR operator_id IS NOT NULL),
  CHECK(actual_end IS NULL OR actual_end>=actual_start),
  CHECK(status NOT IN ('completed','interrupted') OR (actual_start IS NOT NULL AND actual_end IS NOT NULL)),
  CHECK(status<>'in_progress' OR (actual_start IS NOT NULL AND actual_end IS NULL)),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist
    (instrument_id WITH =, tstzrange(reserved_start,reserved_end,'[)') WITH &&)
    WHERE (status IN ('requested','confirmed','in_progress','completed','interrupted'))
);
CREATE UNIQUE INDEX one_actual_operator ON bookings(instrument_id) WHERE status='in_progress';
CREATE INDEX bookings_time ON bookings(starts_at,ends_at);
CREATE TABLE booking_samples (
  booking_id TEXT NOT NULL REFERENCES bookings(id), sample_id TEXT NOT NULL REFERENCES samples(id),
  PRIMARY KEY(booking_id,sample_id)
);
-- Buffers and furnace limits are enforced even for writes outside the HTTP API.
CREATE FUNCTION booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource instruments%ROWTYPE;
BEGIN
  SELECT * INTO resource FROM instruments WHERE id=NEW.instrument_id FOR SHARE;
  IF TG_OP='INSERT' OR NEW.instrument_id<>OLD.instrument_id THEN
    NEW.instrument_category:=resource.category;
  ELSE
    NEW.instrument_category:=OLD.instrument_category;
  END IF;
  IF TG_OP='INSERT' OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR NEW.instrument_id<>OLD.instrument_id THEN
    NEW.setup_minutes:=resource.setup_minutes;
    NEW.cleanup_minutes:=resource.cleanup_minutes;
  ELSE
    NEW.setup_minutes:=OLD.setup_minutes;
    NEW.cleanup_minutes:=OLD.cleanup_minutes;
  END IF;
  NEW.reserved_start:=NEW.starts_at-make_interval(mins=>NEW.setup_minutes);
  NEW.reserved_end:=NEW.ends_at+make_interval(mins=>NEW.cleanup_minutes);
  IF NEW.kind='booking' AND NEW.instrument_category='Furnace' THEN
    IF (TG_OP='INSERT' OR NEW.details IS DISTINCT FROM OLD.details OR NEW.instrument_id<>OLD.instrument_id OR (NEW.status='in_progress' AND OLD.status<>'in_progress')) AND (resource.max_temperature_c IS NULL OR NOT (NEW.details ? 'targetTemperatureC')
       OR (NEW.details->>'targetTemperatureC')::numeric<=0
       OR (NEW.details->>'targetTemperatureC')::numeric>resource.max_temperature_c) THEN
      RAISE EXCEPTION 'Furnace target must be within the configured maximum' USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('completed','interrupted') AND NOT NEW.unloaded THEN
      RAISE EXCEPTION 'Confirm furnace unloading before releasing actual usage' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_booking BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION booking_guard();
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id), event_key TEXT NOT NULL,
  message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ,
  UNIQUE(user_id,event_key)
);
CREATE INDEX notifications_user ON notifications(user_id,created_at);
