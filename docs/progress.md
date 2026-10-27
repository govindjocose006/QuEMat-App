## 28 October 2026 — Supervisor privacy and focused notifications

Prepared from released main `9ae2097`. Restrict cross-author weekly report access to the application supervisor, including old notification links and counts. Add a version-checked escalation action for assigned issue handlers, and send supervisors escalation lifecycle alerts instead of routine work updates. Stop automatic supervisor broadcasts for unrelated bookings, orders and meetings; retain monitoring and direct participation alerts. No schema migration or production data change. Validation and release status are recorded in the PR.

# QuEMat Lab Hub progress

## Workspace UI refresh — preview preparation, 2026-10-27

The released application now includes Phase 4 and PRs #11–12 at main `1e59bc9`.
The older phase-status sections below are historical and are not the current release inventory.

The `feat/workspace-clarity` branch reorganizes the existing interface: grouped
navigation, compact welcome tips and instrument rows, separate follow-up summaries,
and persistent phone navigation. No database, permission or infrastructure changes.
See [workspace refresh](workspace-refresh.md) and its PR for validation and screenshots.
The redesign is for preview review; it has not been merged or released to production.

## Current released baseline — 2026-10-25 (Asia/Kolkata)

Phases 1, 2, 3A, 3B and 3C are released. Phase 3C was merged through
[PR #6](https://github.com/govindjocose006/QuEMat-App/pull/6).
It is no longer preview-only. The production database has migrations 001–005.

The Windows operator confirmed a fresh encrypted backup/full archive read,
guarded migration 005 with preservation across all 22 original tables, then
retention/constraint verification. No fixtures ran. PR #6 records green reviewed-head
and post-merge CI plus live health, matching client assets and protected-access checks.
Private authenticated production acceptance is separate from those checks.

The user confirmed the isolated preview workflows: meetings, attendee privacy,
notes, owned actions, calendar export, notice acknowledgements and confirmation
after corrections. Earlier booking/weekly/issue acceptance is recorded in the
merged feature PRs. Detailed historical preparation notes remain in Git history;
this summary replaces their outdated pending-release descriptions without
republishing infrastructure inventories or operational history.

## Completed features

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

Phase 4 (chemicals and orders) is implemented for isolated preview review on
`feature/phase-4-chemical-orders`; migration 006 and private preview acceptance
are required before any production release. See [Phase 4](phase-4.md). Incoming external samples, facility
calls/proposals, background reminders and PWA work remain future stages.
The current app does not deliver background email/push reminders.

Keep all credentials, local configuration, backup archives, receipts and
passphrases private. Historical migrations and guarded release scripts are not
to be rerun for application-only updates. Preserve the existing free resources.

## Phase 4 release preparation

Private Phase 4 preview acceptance is user-confirmed, including the repeated-open
correction. Independent migration-006 backup, full-row preservation, catalog
validation, offline diagnostics and Windows setup are prepared for review. See
[the guarded release guide](phase-4-release.md). No production config, backup,
migration, merge or deployment has been performed for Phase 4. Exact-head CI
results and readiness are recorded in PR #8; previous guards/backups stay pinned.
