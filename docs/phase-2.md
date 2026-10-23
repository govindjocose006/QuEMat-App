# Phase 2: samples and instrument scheduling

Phase 2 was released on 2026-10-23 at https://quemat-app.vercel.app through PR #1,
merge commit `4d34d5408207babb78d6cfa59108dfa872287534`. The user approved the
isolated preview and completed the private production backup and migration before
merge. See [release verification](progress.md) and the
[guarded production release procedure](phase-2-release.md).

## Daily workflow

1. Register a sample under **Samples**, or use **Quick create sample** while
   booking. The database assigns a permanent `QEM-<sequence>` code and UUID.
   Different batches may share a compound. Only the owner or a lab manager can
   edit/archive a sample; historical booking descriptions remain unchanged.
2. Open **Calendar**, select day/week/month and an instrument, and reserve a slot.
   All entered/displayed times use Asia/Kolkata; storage uses UTC timestamps.
   Phone layouts show a daily agenda. Choose the actual operator, participants,
   one or more samples, project, and measurement/process type. All operators and
   participants must be approved, active members.
3. PPMS/SQUID forms collect temperature and field ranges with units, sequence,
   mass, mounting and accessories. Measurement choices are suggestions and allow
   custom text; they do not establish installed accessories. Furnace forms
   collect target temperature, stages, atmosphere and crucible notes. Reserve
   cooling time as part of occupancy. Sputtering records target, substrate,
   RF/DC/other mode, gas, pressure, power, duration, thickness and cleaning plan.
4. A scheduled slot is **confirmed** unless instrument settings require approval.
   **Requested** slots also reserve capacity while an administrator/supervisor
   reviews them. Rejection/cancellation releases the slot. No training permission
   is inferred from directory names.
5. During the scheduled interval, the actual operator or a lab manager checks in.
   Only this action establishes **confirmed in use**. Check-in is refused if
   previous actual usage or actual cleanup is unfinished. A missed slot must be
   rescheduled before check-in.
6. Complete or interrupt the run with a summary and handover notes; optionally
   attach an HTTP(S) result link. For furnaces, explicitly confirm cooling and
   unloading before either action can release actual usage. No timer releases a
   furnace. Running bookings cannot be cancelled or rescheduled.
7. Report an overrun with an estimated end and handover notes. Bookers and operators of affected reservations, plus participants in the
   current run, receive persistent in-app notifications. Other
   reservations are never silently shifted. The dashboard also flags elapsed
   scheduled end times while actual usage remains active.

Administrators and application supervisors are lab managers for Phase 2. They
can manage bookings, approval decisions, maintenance and allocated windows.
Membership and instrument settings remain administrator-only as in Phase 1.
Members can edit/cancel their own bookings or bookings they operate; check-in
requires the actual operator or a manager. An academic Supervisor title does
not grant these permissions. Instrument-scoped coordinator roles remain optional
future configuration; the current approval queue uses lab managers.

## Conflict and history rules

`002_scheduling.sql` adds tables without changing Phase 1 records. PostgreSQL's
`btree_gist` extension and a GiST exclusion constraint prevent intersecting
half-open reservation ranges for the same instrument, including concurrent
transactions and direct SQL writes. A trigger calculates occupied ranges from
scheduled times and setup/cleanup buffers. Exact buffer-adjusted adjacency is
allowed. Maintenance uses the same reservation table and exclusion constraint.

Requested, confirmed, in-progress, completed and interrupted records retain their
scheduled ranges. Cancelled/rejected records release them. Completed runs retain
their originally reserved time; early completion does not silently free a slot.
Buffer values are snapshots: later instrument edits do not rewrite existing
reservations; rescheduling adopts the current buffers. Actual end plus the
snapshotted cleanup duration separately prevents premature check-in.

A partial unique index permits only one in-progress run per instrument. Actual
usage has its own start/end timestamps and never extends another reservation's
schedule. Changes are transactionally audited with before/after state. Optimistic
versions reject stale sample/booking edits. Historical sample descriptions are
retained for unchanged sample selections, including batch, preparation, handling
and quantity fields, even when a booking is rescheduled. The instrument category
is also snapshotted so renaming a furnace category cannot bypass unloading.
Archiving users, samples or instruments preserves their existing references.

Allocated scheduling requires an explicitly recorded window and reference;
reservations plus buffers must fit within it. An internal booking is never shown
as an institutional approval. Windows are added by lab managers; corrections can
be made by adding the correct window before creating reservations. No institute
allocation is invented by default.

## Notifications and availability

Notifications are inserted atomically with booking changes and deduplicated by
recipient/event/version. The inbox is private to the recipient, retains records,
and displays the latest 200. It and the usage/calendar views refresh every 30
seconds while open. Read state is persistent. These are in-app notifications;
there is no email, push delivery or closed-app reminder scheduler in this phase.

The overview prioritizes actual operator, sample, current usage and next booking;
training information is collapsed. “No confirmed usage” is not a sensor reading
or a guarantee of physical availability. Instrument maintenance/out-of-service
settings still prevent new bookings and check-in.

## Isolated validation

Never use the production `.env` for tests or Phase 2 development. API tests use
fresh in-memory PGlite databases; browser tests create a fresh temporary database
and synthetic accounts, then remove it. Neither runner loads application `.env`.
For a separate development instance, explicitly clear hosted URLs:

```sh
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 NODE_ENV=development \
LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/phase2-dev npm run db:migrate
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 NODE_ENV=development \
LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/phase2-dev npm run db:seed
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 NODE_ENV=development \
LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/phase2-dev APP_ORIGIN=http://localhost:5173 npm run dev
```

Stop the local server before CLI commands on its embedded database. Use a fresh
isolated administrator for development; do not copy real accounts or lab data.

Validation commands:

```sh
npm run build
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 npm test
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

`npm run test:postgres` additionally tests independent PostgreSQL connections.
It **never reads DATABASE_URL**, rejects non-loopback hosts, and creates/drops a
random `quemat_test_*` database. Supply a dedicated local server and creation
privileges using `PG_TEST_HOST`, `PG_TEST_PORT` (default 55432), `PG_TEST_USER`
(default quemat_test), and optional `PG_TEST_PASSWORD`. CI supplies an ephemeral
PostgreSQL 18 service. A locally installed PostgreSQL 18 instance was also used
for validation; it is separate from both Neon and development PGlite.

Before release: back up production, verify the additive migration in an
isolated PostgreSQL/Neon database, apply it explicitly with an authorized operator,
then deploy and verify the live `/api/health` and booking lifecycle. The Phase 2
health endpoint requires `002_scheduling.sql`. Builds and function cold starts
never migrate production. Preview deployments must have a separate database and
must never inherit the Production DATABASE_URL.

For PR #1 preview provisioning, guarded preview commands, secure synthetic login
and the separate-checkout Windows fallback, see [phase-2-preview.md](phase-2-preview.md).
