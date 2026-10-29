# Deployment and current release

## Current release

Production is released at `64da372` through [PR #14](https://github.com/govindjocose006/QuEMat-App/pull/14), deployed on 28 October 2026 (Asia/Kolkata).
It includes Phases 1–4, PRs #11–12, the workspace redesign in PR #13, and supervisor-focused notifications and weekly-report privacy in PR #14. The database contains migrations 001–006.

PR #14 records production health/database connectivity, matching deployed assets,
protected API access checks and reviewed-commit validation. Authenticated production
acceptance remains a private user check. Historical phase release procedures below
are records of completed work, not instructions to rerun migrations.

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
