# QuEMat Lab Hub progress

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

## Monitoring audit remediation — implemented for review

The six supplied findings are addressed by application/API/UI changes:
instrument state and bookings refresh in one read-only snapshot; the latest actual
handover remains visible with sample IDs; the inbox uses stable pagination and
visibility-scoped unread counts; phones use prominent Inbox access and More;
successful refreshes clear stale errors; release status pages reflect deployed 3C.

No migration, fixtures, password resets, paid services or new infrastructure are
needed. Production is not changed by preparing this branch. See
[monitoring audit details](monitoring-audit.md).

Local build and application/release type checks pass. The targeted scheduling and
meeting suites pass all 29 tests. The complete local suite passes 177 of 178 tests;
one unrelated environment-loader case is blocked by this workspace's IPC permissions.
Hosted CI must pass the full suite, native PostgreSQL queries, desktop/phone
workflows and existing Windows release checks. Final exact-commit results and
any limitations are recorded in the audit-fix PR, not assumed here.

## Next phase

Finish audit-fix review, isolated preview acceptance and the application release
before starting Phase 4 (chemicals and orders). Incoming external samples, facility
calls/proposals, background reminders and PWA work remain future stages.
The current app does not deliver background email/push reminders.

Keep all credentials, local configuration, backup archives, receipts and
passphrases private. Historical migrations and guarded release scripts are not
to be rerun for application-only updates. Preserve the existing free resources.
