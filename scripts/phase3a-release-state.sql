-- One read-only statement. Returns expected schema metadata and aggregate counts,
-- never application records, credentials, arbitrary migration names or SQL text.
WITH expected_tables(name) AS (VALUES
  ('weekly_reports'),('weekly_revisions'),('weekly_comments'),('weekly_reviews'),('weekly_action_events')
), expected_indexes(name) AS (VALUES ('weekly_reports_week'),('weekly_comments_report')
), expected_functions(name) AS (VALUES ('protect_weekly_history()'),('protect_weekly_comment()')
), expected_triggers(relation,name,function_name) AS (VALUES
  ('weekly_revisions','weekly_revisions_immutable','protect_weekly_history()'),
  ('weekly_reviews','weekly_reviews_immutable','protect_weekly_history()'),
  ('weekly_action_events','weekly_actions_immutable','protect_weekly_history()'),
  ('weekly_comments','weekly_comments_immutable','protect_weekly_comment()')
), expected_constraints(relation,name,kind) AS (VALUES
  ('weekly_reports','weekly_reports_owner_id_week_start_key','u'),
  ('weekly_reports','weekly_reports_week_start_check','c'),
  ('weekly_revisions','weekly_revisions_pkey','p'),
  ('weekly_comments','weekly_comments_report_id_revision_fkey','f'),
  ('weekly_reviews','weekly_reviews_report_id_revision_fkey','f'),
  ('notifications','notifications_weekly_report_id_fkey','f'),
  ('notifications','notification_source','c')
)
SELECT jsonb_build_object(
  'expectedDatabase',current_database()='neondb',
  'expectedRole',current_user='neondb_owner',
  'postgres18',current_setting('server_version_num')::integer BETWEEN 180000 AND 189999,
  'migrations',jsonb_build_object(
    'foundation',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='001_foundation.sql'),
    'scheduling',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='002_scheduling.sql'),
    'weekly',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='003_weekly_progress.sql'),
    'unexpectedCount',(SELECT count(*) FROM public.schema_migrations WHERE name NOT IN ('001_foundation.sql','002_scheduling.sql','003_weekly_progress.sql'))
  ),
  'weeklyTables',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM expected_tables),
  'weeklyIndexes',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM expected_indexes),
  'weeklyFunctions',(SELECT jsonb_object_agg(name,to_regprocedure('public.'||name) IS NOT NULL) FROM expected_functions),
  'weeklyTriggers',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND NOT t.tgisinternal)) FROM expected_triggers e),
  'weeklyTriggersEnabled',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND t.tgfoid=to_regprocedure('public.'||e.function_name) AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal)) FROM expected_triggers e),
  'weeklyConstraints',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation))) FROM expected_constraints e),
  'weeklyConstraintsValid',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation) AND c.contype::text=e.kind AND c.convalidated)) FROM expected_constraints e),
  'notifications',jsonb_build_object(
    'weeklyColumn',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass AND attname='weekly_report_id' AND NOT attisdropped),
    'bookingColumnNotNull',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass AND attname='booking_id' AND NOT attisdropped AND attnotnull)
  ),
  'phase2Safeguards',jsonb_build_object(
    'overlap',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_no_overlap' AND contype='x' AND convalidated),
    'actualUsageUnique',EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.one_actual_operator') AND indrelid='public.bookings'::regclass AND indisunique AND indisvalid),
    'bookingGuard',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.bookings'::regclass AND tgname='enforce_booking' AND tgfoid=to_regprocedure('public.booking_guard()') AND tgenabled IN ('O','A') AND NOT tgisinternal),
    'btreeGist',EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist')
  ),
  'counts',jsonb_build_object(
    'users',(SELECT count(*) FROM public.users),'instruments',(SELECT count(*) FROM public.instruments),
    'samples',(SELECT count(*) FROM public.samples),'bookings',(SELECT count(*) FROM public.bookings),
    'bookingsWithActualStart',(SELECT count(*) FROM public.bookings WHERE actual_start IS NOT NULL),
    'bookingsWithActualEnd',(SELECT count(*) FROM public.bookings WHERE actual_end IS NOT NULL),
    'notifications',(SELECT count(*) FROM public.notifications),'auditEvents',(SELECT count(*) FROM public.audit_events)
  )
) AS state;
