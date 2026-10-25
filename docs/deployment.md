# Deployment and current release

## Current release

Phases 1, 2, 3A, 3B and 3C are released. Phase 3C was released on
2026-10-25 (Asia/Kolkata) through
[PR #6](https://github.com/govindjocose006/QuEMat-App/pull/6).
The released database contains migrations 001–005. The operator's encrypted backup,
guarded migration and record-preservation verification passed; no fixtures ran.
PR #6 records reviewed-head/main CI and live health, matching client assets and
anonymous-access denial. The isolated preview remains separate.

Private authenticated production acceptance is distinct from those checks and
the accepted preview workflows. Phase 4 has not started. Monitoring audit fixes
are application-only changes requiring review, validation and the normal app
deployment; preparing a branch does not itself change production.

## Architecture and environment separation

The existing Vercel project serves the Vite/React client and an Express API through
a Node.js Function. Persistent data lives in Neon PostgreSQL. The function does
not use the deployment filesystem as a database and refuses a local fallback.

Production and Preview must retain separate database/origin bindings. Keep their
exact values in the hosting dashboard or restricted local operator configuration.
Do not put credentials, private connection URLs or configuration files in Git,
chat or screenshots. Never use production data for automated tests.

The runtime uses its server-only pooled DATABASE_URL. Trusted operator commands
use the intended direct connection when required by their reviewed configuration.
APP_ORIGIN must match that environment's canonical HTTPS origin exactly.
Never expose credentials through VITE_-prefixed client variables.

Use the repository's pinned Node version and lockfile. Existing build settings
must serve the compiled client and API together; retain authentication, approvals,
security headers and source-specific notification authorization.

## Review and deployment gates

1. Check the exact proposed commit/diff and all required CI results.
2. Validate application workflows in the existing isolated synthetic preview.
3. For a schema change, prepare an independent reviewed migration/release plan
   before touching production. It must preserve existing records and history.
4. Application-only changes need no migration or fixtures. Do not rerun a previous
   phase's database commands merely to deploy new client/API code.
5. After the normal authorized application release, check health/database
   connectivity, the deployed commit/client and protected access. The user signs
   in privately for acceptance; do not request passwords or create test accounts
   or physical instrument usage in production.

Builds and cold starts never migrate the schema or bootstrap accounts. Do not
change production variables, plan levels or existing preview bindings as part of
a routine client/API deployment. Keep all earlier backups/receipts untouched.

## Recovery and historical procedures

Stop after a failed or uncertain migration or preservation check. Preserve the
private evidence and use reviewed read-only diagnostics before considering a
retry. Counts/catalogs alone do not establish original row-content preservation
or prove that a previous attempt fully rolled back. No restore or rollback is
automatic.

Detailed historical phase procedures remain in Git history; completed release
status is summarized in [progress](progress.md). Existing migration-specific
scripts retain their pinned guards and must not authorize unrelated migrations.
The completed [Phase 3C status](phase-3c-release.md) is not an instruction to rerun 005.

No upgrades, trials, cloud snapshots, additional infrastructure or paid services
are needed for the monitoring audit fixes. Continue using the existing free
resources within ₹0. Background email/push delivery and private uploads remain
separate future work.
