# QuEMat Lab Hub progress

## Current production — 28 October 2026 (Asia/Kolkata)

Released main is `64da372`, including Phases 1–4 and PRs #11–14. The database has migrations 001–006. [PR #14](https://github.com/govindjocose006/QuEMat-App/pull/14) records the deployment and validation.

The workspace redesign (PR #13) is live: grouped navigation, compact welcome tips and instrument rows, separate follow-up summaries and persistent phone navigation.

Supervisor privacy and focused notifications (PR #14) are live: only authors and the supervisor can read submitted weekly reports; drafts stay author-only. Assigned issue handlers can escalate to the supervisor, who receives escalation milestones while retaining full monitoring access.

The audit recovery fixes are being prepared separately; they are not part of this production baseline.

All dated release sections below are historical snapshots.

## Historical released baseline — 2026-10-25 (Asia/Kolkata)

Phases 1, 2, 3A, 3B, 3C and 4 are released. Phase 4 was merged through
[PR #8](https://github.com/govindjocose006/QuEMat-App/pull/8) as `df0049c` after
explicit user release authorization. The production database has migrations 001–006.

The Windows operator confirmed a fresh encrypted Phase 4 backup/full archive read,
guarded migration 006 with preservation across all 31 original tables, then
retention/constraint verification. No fixtures ran. PR #8 records reviewed-head and
post-merge CI, production deployment and live verification. Health checks migration
006; client assets match the accepted build and eleven protected APIs reject
anonymous requests. Private authenticated Phase 4 production acceptance is pending.

The user confirmed the isolated preview workflows: meetings, attendee privacy,
notes, owned actions, calendar export, notice acknowledgements and confirmation
after corrections. Earlier booking/weekly/issue acceptance is recorded in the
merged feature PRs. Detailed historical preparation notes remain in Git history;
this summary replaces their outdated pending-release descriptions without
republishing infrastructure inventories or operational history.

## Features at the 25 October baseline

- Authentication, approved membership and administrator-controlled permissions.
- Fifteen configured instruments; secondary training information and retained history.
- Stable sample IDs, active/archived views and linked measurement history.
- Detailed bookings, database conflict protection, maintenance/buffers, actual
  usage, handovers and mandatory furnace unloading confirmation.
- Weekly drafts, immutable submitted revisions, mentor/supervisor reviews and actions.
- Shared issues/requests with explicit acknowledgement, optional status reasons,
  retained discussion/history and server-enforced permissions.
- Private selected-attendee meetings, notes, owned dated actions and calendar export.
- Notices with publishing/pinning/expiry and explicit revision-specific reading.
- Persistent notifications, dashboard integration and distinct navigation icons.
- Chemical requests, recorded orders and exact INR costs, partial deliveries,
  corrections/cancellation, retained history and linked notifications. The tracker
  does not place purchases or payments.

## Monitoring audit remediation — released

The six supplied findings are addressed by application/API/UI changes:
instrument state and bookings refresh in one read-only snapshot; the latest actual
handover remains visible with sample IDs; the inbox uses stable pagination and
visibility-scoped unread counts; phones use prominent Inbox access and More;
successful refreshes clear stale errors; release status pages reflect deployed 3C.

No migration, fixtures, password resets, paid services or new infrastructure are
needed. PR #7 merged and released as `4697ba8` on 2026-10-25 after user-confirmed
preview acceptance and explicit release authorization. See
[monitoring audit details](monitoring-audit.md).

The reviewed head `55a1060` passed 179 isolated tests, 23 native PostgreSQL checks,
30 desktop/phone browser checks, build/type checks, Windows checks and a clean
dependency audit. This includes the Vercel `path` query-metadata correction found
during private preview testing. The production deployment is ready; final live and
post-merge CI results are recorded in PR #7. Private production acceptance remains
separate from the user-confirmed preview checks.

## Next phase

Phase 4 (chemicals and orders) is released; private production acceptance is the
next check. See [Phase 4](phase-4.md). Incoming external samples, facility
calls/proposals, background reminders and PWA work remain future stages.
The current app does not deliver background email/push reminders.

Keep all credentials, local configuration, backup archives, receipts and
passphrases private. Historical migrations and guarded release scripts are not
to be rerun for application-only updates. Preserve the existing free resources.

## Phase 4 release evidence

Private Phase 4 preview acceptance is user-confirmed, including the repeated-open
correction. Independent migration-006 backup, full-row preservation, catalog
validation, offline diagnostics and Windows setup passed. The operator's backup was
122,837 encrypted bytes with full archive-read validation; migration reported
APPLIED/PASSED and verify reported original records RETAINED and constraints
VERIFIED. This is archive validation, not a full restore drill.

Reviewed-head CI passed 206 isolated tests, 28 native PostgreSQL checks, 32
desktop/phone workflows, twelve Windows offline checks, build/type checks and a
zero-vulnerability audit. Deployment uses the existing free project/resources;
production configuration and preview bindings were not changed by release. All
earlier and current private backups/receipts remain untouched. The
[guarded release guide](phase-4-release.md) is retained as operational history;
do not rerun completed setup, backup or migration steps for application updates.
