CREATE SEQUENCE chemical_order_number;
CREATE TABLE chemical_orders (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE DEFAULT ('ORD-'||nextval('chemical_order_number')),
 requester_id TEXT NOT NULL REFERENCES users(id), chemical TEXT NOT NULL CHECK(length(trim(chemical)) BETWEEN 2 AND 200),
 cas_number TEXT NOT NULL DEFAULT '',purity TEXT NOT NULL DEFAULT '',catalogue TEXT NOT NULL DEFAULT '',
 quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000), unit TEXT NOT NULL CHECK(unit IN ('g','kg','mg','mL','L','bottle','pack','piece')),
 purpose TEXT NOT NULL CHECK(length(trim(purpose)) BETWEEN 3 AND 2000), project TEXT NOT NULL DEFAULT '',preferred_supplier TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',
 estimated_cost_paise BIGINT CHECK(estimated_cost_paise BETWEEN 0 AND 100000000000),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','ordered','part_received','received','cancelled')),
 supplier TEXT NOT NULL DEFAULT '', ordered_by TEXT REFERENCES users(id),ordered_on DATE,expected_on DATE,cost_paise BIGINT CHECK(cost_paise BETWEEN 0 AND 100000000000),reference TEXT NOT NULL DEFAULT '',
 received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((ordered_by IS NULL AND ordered_on IS NULL AND supplier='' AND expected_on IS NULL AND cost_paise IS NULL AND reference='' AND status IN ('requested','cancelled')) OR (ordered_by IS NOT NULL AND ordered_on IS NOT NULL AND length(trim(supplier))>=2 AND status<>'requested')),
 CHECK(expected_on IS NULL OR expected_on>=ordered_on),
 CHECK((status IN ('requested','ordered') AND received_quantity=0) OR (status='part_received' AND received_quantity>0 AND received_quantity<quantity) OR (status='received' AND received_quantity=quantity) OR status='cancelled')
);
CREATE TABLE chemical_order_events (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES chemical_orders(id),actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('requested','edited','ordered','order_updated','delivery','cancelled')),
 version INTEGER NOT NULL CHECK(version>0),before_state JSONB,after_state JSONB NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(order_id,version)
);
CREATE TABLE chemical_deliveries (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES chemical_orders(id),received_by TEXT NOT NULL REFERENCES users(id),quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000),received_on DATE NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_chemical_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Chemical order history and deliveries are append only'; END; $$;
CREATE TRIGGER chemical_events_immutable BEFORE UPDATE OR DELETE ON chemical_order_events FOR EACH ROW EXECUTE FUNCTION protect_chemical_history();
CREATE TRIGGER chemical_deliveries_immutable BEFORE UPDATE OR DELETE ON chemical_deliveries FOR EACH ROW EXECUTE FUNCTION protect_chemical_history();
CREATE FUNCTION protect_chemical_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Chemical orders are retained'; END IF;
 IF (NEW.id,NEW.code,NEW.requester_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.code,OLD.requester_id,OLD.created_at) THEN RAISE EXCEPTION 'Chemical order identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER chemical_identity BEFORE UPDATE OR DELETE ON chemical_orders FOR EACH ROW EXECUTE FUNCTION protect_chemical_identity();
CREATE INDEX chemical_orders_work ON chemical_orders(status,created_at DESC,id);
CREATE INDEX chemical_orders_requester ON chemical_orders(requester_id,status);
CREATE INDEX chemical_orders_due ON chemical_orders(expected_on) WHERE status IN ('ordered','part_received');
CREATE INDEX chemical_deliveries_order ON chemical_deliveries(order_id,created_at,id);
ALTER TABLE notifications ADD COLUMN order_id TEXT REFERENCES chemical_orders(id);
ALTER TABLE notifications DROP CONSTRAINT notification_source;
ALTER TABLE notifications ADD CONSTRAINT notification_source CHECK(num_nonnulls(booking_id,weekly_report_id,issue_id,meeting_id,notice_id,order_id)=1);
