# QuEMat Lab Hub progress

## Confirmed scope

The complete original specification is saved in [requirements.md](requirements.md).
The user selected **Phase 1: foundation, accounts, onboarding, and instruments**,
then requested **Vercel** and confirmed **Neon PostgreSQL** as the hosted database.
Only Phase 1 is implemented. Later workflows are described, not presented as working.

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

Phase 2: shared sample identities, conflict-protected reservations, instrument-
specific measurement details, and explicit check-in/completion. Implement booking
concurrency constraints and tests then; Phase 1 does not claim scheduling readiness.
