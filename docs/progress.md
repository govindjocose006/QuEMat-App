# QuEMat Lab Hub progress

## Confirmed scope

The complete original specification is saved in [requirements.md](requirements.md).
The user selected **Phase 1: foundation, accounts, onboarding, and instruments**,
then requested **Vercel** and confirmed **Neon PostgreSQL** as the hosted database.
Phases 1 and 2 are deployed. The user approved the Phase 2 preview and authorized
release after a private production backup and migration. Later phases remain
unimplemented.

## Phase 2 production release (2026-10-23)

- The user completed the private Windows backup, migration and verification.
  The encrypted archive was 30,605 bytes and passed the release tool's validation.
  Migration reported `APPLIED` and `recordPreservation: PASSED`; before/after
  counts matched: 1 user, 15 instruments, 12 training entries, 0 SOP links,
  18 audit events and 1 write-lock row. Verification retained all original IDs,
  found both migrations and verified the booking constraints. No fixtures ran.
  These are user-reported operator results; credentials and the archive stayed
  on their Windows computer. A complete database restore drill was not performed.
- Checked PR #1 at `4cb3ed1eef87dd00655576c69d7e5e989a269f02`: open, mergeable,
  clean and all CI checks successful. Validation includes the build, 71 isolated
  API/configuration/tool tests, 10 desktop/phone browser tests and 8 native
  PostgreSQL concurrency checks. No automated suite ran against production.
- Merged the exact checked head to `main`, producing release commit
  `4d34d5408207babb78d6cfa59108dfa872287534`. Its tree matches the checked PR head.
  The existing Vercel Git integration created Production deployment
  `dpl_4DmeLq3AoQEHfFJKwV5uDiamPaKB`, READY with the canonical alias assigned.
- Live URL: https://quemat-app.vercel.app. `/api/health` returns HTTP 200 and
  `{"status":"ok"}`; this Phase 2 endpoint queries the Neon migration ledger for
  `002_scheduling.sql`. The client asset `index-CaPwyogW.js` is served and contains
  Samples, Calendar, notifications, check-in and handover interfaces. This proves
  deployed code/schema connectivity, not every authenticated workflow.
- Live anonymous requests to instruments, samples, bookings, notifications and
  member administration return 401 with `Cache-Control: no-store`. Existing
  administrator sign-in, all 15 instruments in the UI and a small create/persist/
  cancel/archive workflow are awaiting the user's private browser check.
  The agent has created no production sample, booking or account records.
- Verified Production and branch-specific Preview variable bindings and hosting
  settings remain unchanged. Existing Vercel Hobby/basic plan, no trial, no paid
  services or additional infrastructure. Preview remains separate and Phase 3
  has not started. The historical cloud DNS blocker does not affect the verified
  Vercel-to-Neon health query.

## Phase 2 release preparation (2026-10-23)

- PR #1 was open, mergeable and green at `539141e`; latest release-tool changes
  require their own successful CI before merge. Production remains `dc40148`.
- Verified existing Vercel Hobby/basic configuration, no trial, `main` production
  branch, and separate branch-specific Preview variables. No variables changed.
- Read-only Neon metadata verified production project `wandering-truth-11355959`,
  branch `br-flat-band-a1umhh3i`, direct endpoint
  `ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech`, database `neondb`, role
  `neondb_owner`, PostgreSQL 18. Native DNS still fails `EAI_AGAIN/getaddrinfo`.
  Metadata verification is not a successful SQL connection.
- Added [private Windows release steps](phase-2-release.md) and explicit-target
  tooling: free local encrypted `pg_dump`, roundtrip checksums/full archive read,
  backup-gated pinned Phase 2 migration, transactional legacy-record preservation
  checks and post-migration verification. No seeds, fixtures or production tests.
- Nineteen new isolated release tests passed for target rejection, encryption,
  damaged/wrong-password backup rejection, receipt gating, CRLF handling,
  additive migration preservation/idempotency and rollback on failure. The
  Windows PowerShell wrapper and native `pg_dump` still require execution on the
  trusted Windows machine; no live backup/restore or migration is claimed.
- Full local validation passed: 71 API/configuration/tool tests, production build,
  application type checks and a separate strict release-tool TypeScript check.
- **Waiting for successful Windows backup, migration and verification outputs.**
  No production schema, data, deployment or configuration has been changed.
  No paid resources, trials or additional infrastructure were used. Phase 3 is
  unstarted. A complete restore drill remains separate from archive-read checks.

## Phase 2 implementation (2026-10-22)

- Shared samples with permanent IDs, batch/project/handling information, ownership,
  versioned edits, archival, and booking/result history with sample snapshots.
- Day/week/month instrument calendar and phone agenda; actual operators, multiple
  samples, participants, measurement/process details and IST/UTC conversion.
- PPMS/SQUID, furnace and sputtering forms; configured furnace temperature limits.
- PostgreSQL exclusion constraint, buffer trigger, maintenance blocks, requested
  approvals, allocated windows and unique active-usage constraint.
- Rescheduling, cancellation, check-in, completion/interruption, explicit furnace
  unloading, overrun impact, handover notes and result links.
- Actual-usage/next-booking overview and persistent private booking notifications.
- Phase 1 authentication, approval, CSRF, membership and historical records retained.
- Implementation and operating assumptions: [Phase 2 guide](phase-2.md).
- All automated tests use isolated synthetic databases. Production has not been
  migrated or modified during Phase 2 implementation.
- Validation: production build/type checks passed; all 40 API/configuration tests
  passed; 8 native PostgreSQL 18 checks passed across independent connections;
  10 desktop/phone browser tests passed, including automated WCAG checks and
  no-horizontal-overflow assertions. All data was isolated and synthetic.
- Browser validation covers samples, PPMS and sputtering forms, furnace maximum
  rejection/unloading, rescheduling, actual usage, handover, maintenance and the
  persistent inbox. Native tests cover conflict exclusion, buffer adjacency,
  released cancellations, concurrent rescheduling and unique actual usage.
- Native concurrency validation also passed 50 consecutive isolated runs after
  hardening teardown to wait for disconnected clients. Concurrent GiST updates
  can abort the loser with either exclusion violation or deadlock detection;
  tests verify exactly one committed reschedule and no overlapping reservations.
- No Phase 2 production migration or deployment has been performed. In-app
  notifications refresh while open; email/push and scheduled reminders are deferred.

## PR #1 preview preparation

- Read the Phase 2 and deployment guides and verified the existing Neon project
  and Vercel project through their APIs. Production still targets Phase 1 commit
  `dc40148`; its variables have not been changed.
- Neon schema-only branch creation is blocked by HTTP 412 at `console.neon.tech`
  because the existing project has a legacy `anonymous` web role. The available
  key is project-scoped and cannot create a separate project. No preview branch
  or data-bearing clone was created.
- Added guarded preview-only migration/fixture/verification commands and a
  [Windows fallback](phase-2-preview.md) using a separate checkout, private
  configuration, synthetic accounts and private interactive password setup.
- Preview preparation requires an empty, independently selected database; later
  operations verify its stored preview identity. Production endpoints and
  connection-query overrides are rejected; ordinary `.env` files are not loaded.
- The new preview key is now verified for separate project
  `sparkling-meadow-75486459` (QuEMat PR1 Preview), branch `br-patient-shape-a1fnddux`.
  Created dedicated role and empty database `quemat_pr1_preview` without using
  production credentials or copying accounts/data.
- Saved owner-only ignored preview credentials. Added Vercel Preview-only,
  feature-branch-scoped DATABASE_URL and APP_ORIGIN bindings; Production variables
  remain unchanged. Vercel's saved authentication refreshed successfully.
- Direct operator access from the cloud remains blocked: native DNS fails with EAI_AGAIN/getaddrinfo
  for `ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech`, including with expanded
  execution access. A configured-proxy PostgreSQL attempt terminated before
  queries. No TLS checks or application driver were changed.
- The user initialized the preview from their Windows checkout: both migrations,
  15 instruments, four synthetic accounts and two initial samples. The synthetic
  administrator password was set privately.
- Deployed and redeployed PR #1 to Vercel Preview using existing Hobby/basic
  resources. Live `/api/health` returns 200 with `{"status":"ok"}`. Sample/booking
  writes and reads confirm hosted PostgreSQL connectivity through Vercel.
- Live checks passed for sample ownership/shared access; PPMS details and actual
  operator; overlapping and simultaneous booking rejection; cancellation/reuse;
  furnace maximum/check-in/unloading/completion/handover; member/pending access
  boundaries; cross-origin denial; protected session cookies; and notifications.
- After redeployment, the existing session, sample `QEM-3`, completed furnace
  actual usage/handover, cancellation history and notifications persisted.
  Logout then denied protected access. Synthetic check members were approved by
  the user through the existing administrator UI; no administrator password was
  shared and no extra administrator was created.
- Preview: https://quemat-app-git-feature-phase-2-bookings-govindjocose-2552.vercel.app
  Verified deployment `dpl_Ckr5hscapdbKUT2UL3NmKQVqDCsq`, source `bbbf774`.
  Production variables and deployment remain unchanged; PR #1 remains open.
- Budget ₹0: no upgrades, paid services, trials, purchases or additional cloud
  infrastructure. Temporary automation authentication was revoked after checks.
- Cloud Chromium live screenshots were blocked by proxy certificate trust
  (`ERR_CERT_AUTHORITY_INVALID`); TLS verification was preserved. Live API results
  and earlier isolated phone/desktop browser tests are separate evidence.
- Local validation passed: build/type checks and 52 API/configuration/tool tests,
  including 12 new preview checks for safe target selection, empty-database
  preparation, identity mismatch rejection and repeatable private fixtures.

## Phase 1 production status

The first Vercel Production deployment was created from `main` at `dc40148`.
The user confirmed https://quemat-app.vercel.app/api/health returns
`{"status":"ok"}` and the app opens correctly. The user completed hosted migrations,
seeding and first-administrator creation and updated the production password.
These user-confirmed live results supersede the earlier connection blockers below.

## Completed features

- TypeScript React/Express app with PostgreSQL migrations and persistent data.
- Vercel function/static-client configuration and Neon connection pooling with
  certificate verification; no production filesystem fallback.
- Credential-free local development using the same PostgreSQL SQL through PGlite.
- Password authentication, database-backed sessions and cross-instance rate limits,
  Origin/CSRF checks, password change, logout, and session revocation.
- Approval-gated onboarding with academic roles separate from application roles.
- Approved PhD/Postdoc mentors and pending assignments for interns/Master's students.
- Trusted interactive first-admin bootstrap and identity-verified password reset.
- Administrator approval, role changes, deactivation, mentor reassignment, and
  protection for the last active administrator.
- All 15 instrument configurations, seven priorities, four separate furnaces,
  preserved labels/training names, and no fabricated member accounts.
- Instrument create/edit/archive/restore, search/status filters, setup/cleanup
  buffers, internal/allocated scheduling configuration, training policies/SOP URLs.
- Atomic audit history and stale-edit detection.
- Responsive private workspace, keyboard-accessible forms/dialogs, and no cached
  lab data or mock booking controls.
- Vercel/Neon deployment, operations, backup, and recovery documentation; CI setup.

## Validation

### Existing Neon connection preparation (2026-10-21)

- Selected organization `org-ancient-moon-23673941`, project
  `wandering-truth-11355959`, and existing branch `production`. The CLI wrote an
  **offline, unverified** local link only. No duplicate resources were created.
- Added a Postgres-only `neon.ts` policy that rejects new/non-production branches.
  Vercel hosting, `pg`, authentication, approvals, and administrator controls remain.
- App and operator scripts now load `.env` and `.env.local`, with process env
  taking precedence. Operators prefer direct `DATABASE_URL_UNPOOLED`; runtime
  continues to use pooled `DATABASE_URL`. Local cloud setup explicitly clears both.
- Build/type checks passed; 28 API/configuration/environment tests and all 6
  desktop/phone browser tests passed using isolated local PostgreSQL data.
- Global Neon CLI installation failed because its global directory was unavailable;
  the npm-exec fallback worked. Optional plugin/skill installation failed because
  the `plugins` and `skills` helpers were absent; consulted official Neon skill
  sources from GitHub instead.
- Browser login failed before issuing a sign-in URL. A direct diagnostic through
  the environment's proxy returned HTTP 403 for `console.neon.tech`. Network access
  and user browser authentication must be restored before proceeding.
- **Blocked:** live project/branch verification, `neon deploy`, credential pull,
  actual Neon queries, hosted migrations/seeding, and first-administrator creation.
  No local test is evidence of a successful Neon connection. The administrator
  must enter their password directly in the documented interactive CLI, never chat.
- Updated the saved cloud configuration draft to clear both connection variables
  for local setup. Review/save/publish in environment settings is still required
  to activate that draft. Phase 2 remains unstarted.

### Phase 1 baseline

- PostgreSQL backend build/type checks passed.
- 25 API/integration/configuration tests passed after the PostgreSQL conversion, covering access
  boundaries, privilege escalation, sessions, CSRF, shared throttling, concurrent
  edits/admin demotions, mentor eligibility/reassignment, migrations/seeding,
  foreign keys, audit immutability, local persistence, and local export restoration.
- All 6 browser tests passed against the PostgreSQL backend: desktop and phone
  workflows plus automated WCAG checks on sign-in, overview, and instrument forms.
  Verified keyboard dialog focus, no page overflow, private access, approvals,
  editing/archiving/restoration, password changes, and logout across tabs.
  Automated checks do not establish complete accessibility conformance.
- Clean frozen-lockfile installation, local migrations/seeding, and compiled server
  startup passed. The Vite development server/API proxy also passed readiness and
  anonymous-access-denial checks.
- Interactive CLI administrator creation and password reset passed in a temporary
  PostgreSQL database; hidden passwords were not echoed.
- Local development data contains exactly 15 supplied instruments and zero member
  accounts. The first real administrator remains a trusted-operator setup step.
- Reusable cloud `install_script` and `start_skill` were saved successfully as a
  configuration draft. Publication/restoration in a new cloud task has not been
  verified; this is separate from Vercel deployment.
- Repository copies are available in `scripts/cloud-install.sh` and
  `docs/cloud-environment.md` for reuse and review.
- Tests use isolated synthetic records, never the development or Neon database.
- No live Vercel deployment, Neon transport connection, hosted CI run, or hosted
  backup/restore has been verified. Relevant credentials/project access are absent.

## Assumptions and setup requirements

- Timezone: Asia/Kolkata. Currency: INR.
- RF/magnetron sputtering initially shares one resource; arc melting/sealing also
  shares one. Administrators can add separate entries and archive combined ones.
- Initial operational status is unverified configuration. Training names do not
  create accounts or grant permission. Akhil N and Akhila remain distinct.
- Registration requires manual identity/email verification and administrator
  approval. Automatic email verification/reset and invitations are not configured.
- Run local migrations, seed, and interactive administrator creation before
  starting development. Stop the local server before CLI database commands.
- Vercel needs server-only `DATABASE_URL` and a canonical HTTPS `APP_ORIGIN`;
  previews need separate Neon databases. See [deployment.md](deployment.md).
- Private attachment uploads are outside Phase 1 and need private object storage
  later; Vercel's local filesystem must never be used for durable uploads.

## Next phase

Complete the private authenticated production check for the released Phase 2.
Phase 3 (weekly progress,
issues, announcements and meetings) has not been started.
