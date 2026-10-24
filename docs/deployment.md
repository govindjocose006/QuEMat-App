# Deploy on Vercel with Neon PostgreSQL

The user selected Vercel and Neon for this app. The client is a Vite/React static
build, and `/api/*` runs through a Node.js Vercel Function. All persistent accounts,
sessions, rate limits, instruments, and audit history live in Neon PostgreSQL.
Nothing depends on a Vercel instance's filesystem or process staying alive.

## Current release

Phase 3A has been accepted in preview and is ready for the authorized production
deployment after final PR #2 CI. The operator completed its guarded production
003 migration on 2026-10-24 using the original verified encrypted backup inside
the 24-hour freshness window. Full-row preservation passed; verification confirms
001/002/003, retained original records and valid constraints. **Do not rerun any
migration during merge, build or deployment.** See [release evidence and private
acceptance steps](phase-3a-release.md). The Phase 2 deployment described below is
the serving version until the existing Vercel Git integration deploys this release.

Phase 2 is deployed to https://quemat-app.vercel.app in the existing Vercel project
`quemat-app`, linked to `govindjocose006/QuEMat-App` branch `main`, Node.js 24, region
`sin1` (Singapore). Production variables are managed in Vercel. The user confirmed
healthy database-backed operation after initializing the production database.
PR #1 was merged on 2026-10-23 at `4d34d5408207babb78d6cfa59108dfa872287534`,
after all checks passed on its exact head `4cb3ed1`. The existing Vercel Git
integration deployed that merge to Production successfully.

Before merge, the user completed the private encrypted backup, additive migration
and verification on Windows using the [guarded release procedure](phase-2-release.md).
Their results retained 1 user, 15 instruments, 12 training entries and 18 audit
events, with the Phase 2 constraints verified. No preview fixtures were run.
Live Phase 2 health returns HTTP 200 and checks `002_scheduling.sql` through Neon;
the deployed client contains the Phase 2 interface and protected APIs reject
anonymous access. The user then verified existing-administrator login, all 15
instruments, Samples/Calendar, sample creation, PPMS booking persistence after
refresh, cancellation and archival in the production browser. Their release-check
booking was cancelled and sample archived; no actual usage was recorded.

Production and branch-specific Preview variables, hosting settings and the
Hobby/basic plan were preserved. See [phase-2.md](phase-2.md) for isolated
development/test commands. Preview environments require a separate database; the saved
Production DATABASE_URL must never be used in preview or automated tests.

The PR #1 preview procedure and Windows fallback are in
[phase-2-preview.md](phase-2-preview.md). Use its explicit preview configuration,
not the production Neon policy or the ordinary `.env`-loading database commands.

The isolated Phase 2 preview is now live at
https://quemat-app-git-feature-phase-2-bookings-govindjocose-2552.vercel.app.
Health, database-backed workflows, access controls and persistence across a
preview redeployment passed live checks. Vercel authentication protects the
preview; then sign into the app with `preview-admin@example.test` and the password
set privately in the trusted terminal. The preview uses existing free resources;
do not upgrade plans, enable paid services/trials or provision extra infrastructure.
The user subsequently approved the preview and authorized the production release
after successful private backup, migration, verification and CI.

A Phase 2 release requires the additive `002_scheduling.sql` migration and
`btree_gist` extension. Run this only as an explicitly authorized operator step,
after backup and isolated validation. No migration runs during a Vercel build or
function cold start. The Phase 2 health check requires the new schema.

## Separate Phase 3A preview

The Phase 3A preview remains separate from production. Follow
[Phase 3A preview steps](phase-3a.md#existing-isolated-preview) using the existing
`quemat_pr1_preview` database in project `sparkling-meadow-75486459`. Apply
`003_weekly_progress.sql` there before deploying the new preview. The Phase 3A
health check requires this migration and never runs it automatically.

Use Preview-only variables scoped to `feature/phase-3a-weekly-progress`. Preserve
Production and the existing Phase 2 Preview bindings. Both preview branches share
the existing synthetic database; the migration is additive and compatible with
Phase 2. Do not copy production data, run the old initial-account fixtures again,
or create infrastructure. The `weekly-fixtures` action adds scoped synthetic
mentor/member/supervisor test accounts without changing existing accounts.

The user accepted the preview and authorized the Phase 3A release subject to a
fresh private verified backup, reviewed migration 003, preservation verification
and final CI before merge/deployment. Follow [the guarded Phase 3A release steps](phase-3a-release.md).
The operator has now completed those database prerequisites; final CI and
merge/deployment remain. The pinned Phase 2
release tool deliberately does not authorize migration 003; use the separate
Phase 3A tool, never preview fixtures or the general migration CLI.

## 1. Link the existing Neon database

Reuse organization `org-ancient-moon-23673941`, project
`wandering-truth-11355959`, and its existing `production` branch. Do not create a
replacement project or branch. Keep Vercel for the frontend and Node API, `pg`
for database access, and the app's existing authentication and approval controls.
Align the Vercel function region with the existing database region.

Install `npm i -g neon@latest`, or use `npx --yes neon@latest` in place of `neon`
if the global installation fails. From the repository root:

```sh
neon login
neon init -y --org-id org-ancient-moon-23673941 --project-id wandering-truth-11355959 --branch production --services postgres
```

Finish any browser sign-in yourself; never send credentials in chat. If optional
plugin installation fails, repeat `init` with `--no-agent-setup`. An offline
`.neon` link is **not verification**. After login, verify the exact project and
existing branch through the CLI and review the plan before applying:

```sh
neon projects get wandering-truth-11355959
neon branches list --project-id wandering-truth-11355959
neon config plan --project-id wandering-truth-11355959 --branch production
neon deploy --project-id wandering-truth-11355959 --branch production
```

The plan must target the existing production branch. Do not accept creation of a
replacement project/branch, unrelated setting changes, or optional services.
`neon.ts` refuses a new or non-production branch and declares no Neon Auth,
Functions, Realtime, Object Storage, Data API, or AI Gateway. Postgres already
exists on the branch. The policy does not remove unrelated existing services.
No `--update-existing` or blanket `--yes` deploy override is needed.

`deploy` pulls credentials into `.env` when it exists, otherwise `.env.local`.
Both files and the CLI's `.neon` context are ignored by Git. All app startup and
database scripts load `.env`, then `.env.local`; the latter wins on duplicate
keys. Existing process variables take precedence over both files, including
empty values. Check for stale overrides privately; do not print either file.
Restrict credential files to their owner (for example, `chmod 600 .env`).

In the Codex cloud workspace the CLI uses the private config directory
`/workspace/.neon-cli`; append `--config-dir /workspace/.neon-cli` to **every**
Neon command there, including login. Use
`npm --cache /workspace/.cache/npm exec --yes --package=neon@latest -- neon`
as the CLI prefix when the global install/cache directories are unavailable.

The attempted cloud login on 2026-10-21 failed before a browser URL was issued:
the environment's network proxy returned HTTP 403 for `console.neon.tech`.
Restore access in the cloud environment's network settings and sign in before
retrying. Postgres also needs outbound connectivity to the project's actual
database endpoint (normally TCP 5432). Do not change drivers or disable TLS to
work around network policy. No live target, migration, seed, or administrator
creation was verified during that attempt.

Obtain the **pooled PostgreSQL connection string** from Neon for the Vercel runtime.
The CLI also pulls `DATABASE_URL_UNPOOLED`, the direct operator connection.
Keep both private. TLS certificate verification remains enabled by the app;
provider `sslmode` query parameters cannot disable it.

Preview code must not connect to this production database. Preview database
provisioning is outside this connection task; leave previews unconfigured until
an isolated target is explicitly selected.

## 2. Prepare the database from a trusted terminal

Install Node 24 and dependencies. Store the selected Neon connection string in a
private local `.env` or `.env.local` as `DATABASE_URL`, or use the CLI-pulled file.
The application uses pooled `DATABASE_URL`. All operator commands prefer
`DATABASE_URL_UNPOOLED` and fall back to `DATABASE_URL` when no direct variable
exists. For a manual setup, put the direct connection in
`DATABASE_URL_UNPOOLED`. Both must point to the verified same branch/database.
Do not put values in Git, shell arguments, screenshots, logs, or chat.
Do not add a `VITE_` prefix: that would expose a variable to the browser build.

From the repository root:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run admin:create
```

The final command prompts interactively for the real first administrator. Passwords
are hidden and never accepted as command-line arguments. No public bootstrap
endpoint or default credentials exist. Repeat seeding does not overwrite edits.
Run this command yourself in a trusted interactive terminal; an agent cannot
collect your password in chat. Do not replace an existing administrator or
create a synthetic production administrator for testing.

Run these commands with the intended database selected. They are deliberately
**not** included in the Vercel build command or function initialization. This
avoids database changes on builds, previews, and cold starts.

## 3. Import the repository into Vercel

Make the reviewed implementation available in the GitHub repository, then import
`govindjocose006/QuEMat-App` in the Vercel dashboard. Select the repository root.
The included `vercel.json` configures:

| Setting          | Value                           |
| ---------------- | ------------------------------- |
| Framework        | Vite                            |
| Node runtime     | 24.x, from package.json engines |
| Install command  | `npm ci`                        |
| Build command    | `npm run build`                 |
| Output directory | `dist/client`                   |
| API function     | `api/index.ts`                  |
| API route        | `/api/:path*` → `/api/index`    |
| Function timeout | 30 seconds                      |

The function uses a small `pg` pool and Vercel's `attachDatabasePool` lifecycle
integration. The frontend and API share an origin; do not configure a separate
public API URL or permissive CORS.

## 4. Configure server environment variables

Set these in the Vercel project's environment settings before deploying:

| Name           | Production                                 | Preview                                                              |
| -------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL` | Production Neon's pooled connection string | Separate preview Neon branch/database                                |
| `APP_ORIGIN`   | Exact canonical HTTPS app origin           | Exact preview origin, or omit to use Vercel's generated `VERCEL_URL` |

Vercel supplies `VERCEL`, `VERCEL_URL`, and production runtime context. The app
requires secure cookies there. `LOCAL_DATABASE_PATH` is ignored when a hosted
connection is configured; local fallback is prohibited in production/Vercel.

For the production domain assigned by Vercel or a custom domain, set `APP_ORIGIN`
to precisely that origin and redeploy. Configure aliases to redirect to the
canonical domain. For previews without an explicit origin, visit the exact
immutable deployment URL represented by `VERCEL_URL`; an unrelated branch alias
will not pass the exact Origin check. Do not solve an origin mismatch by disabling
CSRF or accepting arbitrary Host headers.

Run migrations and seed/bootstrap separately for each preview database you intend
to use. Preview database authentication remains private. Vercel deployment
protection is useful in addition to the app's login and membership checks.

## 5. Deploy and verify

After Vercel builds and deploys:

1. Check `/api/health` for HTTP 200 and `{"status":"ok"}`. A missing schema or
   missing database must fail, not silently create a temporary database.
2. Open the site over HTTPS and sign in with the administrator created in step 2.
3. Verify all 15 instruments, the seven priorities, training names, and furnace
   maxima. Operational status must be verified manually by the lab.
4. Test registration/onboarding from a separate account. Before approval, direct
   API access to `/api/instruments` must return 403. Approve through an authorized
   administrator, then verify read access and denied member editing.
5. Verify an edited instrument and signed-in session survive a new deployment.
   Check logout, role changes, and deactivation revoke access across requests.
6. Confirm that API responses are `no-store` and the session cookie is Secure,
   HttpOnly, and SameSite=Strict. Inspect audit entries as an administrator.

Run these checks against a preview database first. Automated local tests exercise
the SQL and workflows using PGlite; they do not establish live Neon connectivity,
Vercel routing, deployment behavior, or production readiness.

## Private files and future phases

No attachment uploads exist in Phase 1. Do not store files in the Vercel function
filesystem or expose private documents through public URLs. Later attachment
workflows need private object storage with authenticated access and validation.
Current SOP links must point to independently access-controlled documents.

No deployment, background notifications, automated call monitoring, email provider,
or private object-storage service has been provisioned as part of this change.
