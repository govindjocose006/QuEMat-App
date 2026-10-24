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
), issue_tables(name) AS (VALUES ('issues'),('issue_events'),('issue_comments')
), issue_indexes(name) AS (VALUES ('issues_work'),('issues_assignee'),('issues_instrument'),('issue_events_issue'),('issue_comments_issue')
), issue_functions(name) AS (VALUES ('protect_issue_history()'),('protect_issue_identity()')
), issue_function_bodies(name,sha256) AS (VALUES ('protect_issue_history()','e4c95c6b96bb43f9bcd6baf647b4c46851723358d36201527f10f8f9a05005ea'),('protect_issue_identity()','da8660aa4fb9088fe8a68fcc50acd4d91ce29bbcee54b0e04be33709cc036201')
), issue_triggers(relation,name,function_name) AS (VALUES
 ('issues','issues_identity','protect_issue_identity()'),
 ('issue_events','issue_events_immutable','protect_issue_history()'),
 ('issue_comments','issue_comments_immutable','protect_issue_history()')
), issue_constraints(relation,name,kind) AS (VALUES
 ('issues','issues_pkey','p'),('issues','issues_code_key','u'),
 ('issues','issues_title_check','c'),('issues','issues_description_check','c'),
 ('issues','issues_category_check','c'),('issues','issues_priority_check','c'),
 ('issues','issues_data_links_check','c'),('issues','issues_status_check','c'),
 ('issues','issues_version_check','c'),('issues','issues_check','c'),
 ('issues','issues_check1','c'),('issues','issues_check2','c'),('issues','issues_check3','c'),
 ('issue_events','issue_events_kind_check','c'),('issue_events','issue_events_from_status_check','c'),
 ('issue_events','issue_events_to_status_check','c'),('issue_events','issue_events_version_check','c'),
 ('issue_comments','issue_comments_body_check','c'),('issue_comments','issue_comments_data_links_check','c'),
 ('issues','issues_reporter_id_fkey','f'),('issues','issues_assignee_id_fkey','f'),
 ('issues','issues_instrument_id_fkey','f'),('issues','issues_sample_id_fkey','f'),
 ('issues','issues_acknowledged_by_fkey','f'),('issues','issues_resolved_by_fkey','f'),
 ('issue_events','issue_events_pkey','p'),('issue_events','issue_events_issue_id_version_key','u'),
 ('issue_events','issue_events_issue_id_fkey','f'),('issue_events','issue_events_actor_id_fkey','f'),
 ('issue_comments','issue_comments_pkey','p'),('issue_comments','issue_comments_issue_id_fkey','f'),
 ('issue_comments','issue_comments_author_id_fkey','f'),('notifications','notifications_issue_id_fkey','f')
)
SELECT jsonb_build_object(
  'expectedDatabase',current_database()='neondb',
  'expectedRole',current_user='neondb_owner',
  'publicSchema',current_schema()='public',
  'postgres18',current_setting('server_version_num')::integer BETWEEN 180000 AND 189999,
  'migrations',jsonb_build_object(
    'foundation',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='001_foundation.sql'),
    'scheduling',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='002_scheduling.sql'),
    'weekly',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='003_weekly_progress.sql'),
    'issues',EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='004_issues_requests.sql'),
    'unexpectedCount',(SELECT count(*) FROM public.schema_migrations WHERE name NOT IN ('001_foundation.sql','002_scheduling.sql','003_weekly_progress.sql','004_issues_requests.sql'))
  ),
  'issueTables',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM issue_tables),
  'issueSequencePresent',to_regclass('public.issue_number') IS NOT NULL,
  'issueSequence',EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.issue_number') AND relkind='S'),
  'issueIndexes',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM issue_indexes),
  'issueIndexesValid',(SELECT jsonb_object_agg(name,EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||name) AND indisvalid AND indisready)) FROM issue_indexes),
  'issueFunctions',(SELECT jsonb_object_agg(name,to_regprocedure('public.'||name) IS NOT NULL) FROM issue_functions),
  'issueFunctionBodies',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.'||e.name) AND p.prorettype='trigger'::regtype AND encode(sha256(convert_to(replace(p.prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex')=e.sha256)) FROM issue_function_bodies e),
  'issueTriggers',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND NOT t.tgisinternal)) FROM issue_triggers e),
  'issueTriggersEnabled',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND t.tgfoid=to_regprocedure('public.'||e.function_name) AND t.tgenabled IN ('O','A') AND t.tgtype=27 AND NOT t.tgisinternal)) FROM issue_triggers e),
  'issueConstraints',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation))) FROM issue_constraints e),
  'issueConstraintsValid',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation) AND c.contype::text=e.kind AND c.convalidated)) FROM issue_constraints e),
  'weeklyTables',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM expected_tables),
  'weeklyIndexes',(SELECT jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL) FROM expected_indexes),
  'weeklyFunctions',(SELECT jsonb_object_agg(name,to_regprocedure('public.'||name) IS NOT NULL) FROM expected_functions),
  'weeklyTriggers',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND NOT t.tgisinternal)) FROM expected_triggers e),
  'weeklyTriggersEnabled',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgname=e.name AND t.tgrelid=to_regclass('public.'||e.relation) AND t.tgfoid=to_regprocedure('public.'||e.function_name) AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal)) FROM expected_triggers e),
  'weeklyConstraints',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation))) FROM expected_constraints e),
  'weeklyConstraintsValid',(SELECT jsonb_object_agg(e.name,EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname=e.name AND c.conrelid=to_regclass('public.'||e.relation) AND c.contype::text=e.kind AND c.convalidated)) FROM expected_constraints e),
  'notifications',jsonb_build_object(
    'issueColumn',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass AND attname='issue_id' AND NOT attisdropped),
    'issueColumnNullable',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.notifications'::regclass AND attname='issue_id' AND NOT attisdropped AND NOT attnotnull),
    'phase3aSource',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notification_source' AND contype='c' AND convalidated AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=regexp_replace('CHECK ((((booking_id IS NOT NULL) AND (weekly_report_id IS NULL)) OR ((booking_id IS NULL) AND (weekly_report_id IS NOT NULL))))','[[:space:]]','','g')),
    'phase3bSource',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notification_source' AND contype='c' AND convalidated AND regexp_replace(pg_get_constraintdef(oid),'[[:space:]]','','g')=regexp_replace('CHECK ((((booking_id IS NOT NULL) AND (weekly_report_id IS NULL) AND (issue_id IS NULL)) OR ((booking_id IS NULL) AND (weekly_report_id IS NOT NULL) AND (issue_id IS NULL)) OR ((booking_id IS NULL) AND (weekly_report_id IS NULL) AND (issue_id IS NOT NULL))))','[[:space:]]','','g')),
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
    'notifications',(SELECT count(*) FROM public.notifications),'auditEvents',(SELECT count(*) FROM public.audit_events),
    'weeklyReports',(SELECT count(*) FROM public.weekly_reports),
    'weeklyRevisions',(SELECT count(*) FROM public.weekly_revisions),
    'weeklyComments',(SELECT count(*) FROM public.weekly_comments),
    'weeklyReviews',(SELECT count(*) FROM public.weekly_reviews),
    'weeklyActions',(SELECT count(*) FROM public.weekly_action_events)
  )
) AS state;
