# QuEMat Lab Hub

Private laboratory coordination for the QuEMat group at IISER Thiruvananthapuram,
supervised by Dr Deepshikha Jaiswal Nagar.
[Group website](https://sites.google.com/iisertvm.ac.in/quemat).

**Phase 1 and Phase 2 are deployed** at https://quemat-app.vercel.app. Phase 1 provides
accounts, approval-gated onboarding, membership administration, and an editable
register of the 15 supplied instruments. Phase 2 provides
shared samples, calendars, conflict-protected bookings, actual usage and notifications.
See [Phase 2 workflows and isolated validation](docs/phase-2.md). The app uses TypeScript,
React, Express, and PostgreSQL, with **Vercel + Neon** as the deployment target.
**Phase 3A: Weekly Progress** is implemented on `feature/phase-3a-weekly-progress`
for review and isolated preview only. See [the workflow and preview guide](docs/phase-3a.md).
Production remains Phase 2; Phase 3B/3C and later phases are not implemented.

- [Deploy to Vercel and Neon](docs/deployment.md)
- [Reusable cloud environment setup](docs/cloud-environment.md)
- [Full requirements](docs/requirements.md) · [Progress and validation](docs/progress.md)
- [Architecture and permissions](docs/architecture.md) · [Operations and recovery](docs/operations.md)

## Local development

Use Node.js **24** and npm. Run from the repository root:

```sh
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run admin:create
npm run dev
```

Do not overwrite an existing `.env`. In this cloud workspace, use
`npm --cache /workspace/.cache/npm ci` if the default npm cache is unwritable.

Without `DATABASE_URL`, development uses persistent **PGlite**, an embedded
PostgreSQL engine, under ignored `data/postgres/`. This is a local development
backend, not a hosted shared database. Stop the development server before running
CLI database commands. No external keys are needed for local development.

Startup and operator commands load `.env` followed by `.env.local` (Neon CLI's
alternative output file); process variables override both. The app uses pooled
`DATABASE_URL`; database/admin commands prefer `DATABASE_URL_UNPOOLED` when set.
For local-only work, clear **both** variables to avoid targeting a hosted database.

`admin:create` is an interactive, trusted-operator command that prompts for an
email, hidden password with confirmation, and full name. There is **no default
login**. It creates only the first administrator. Additional privileged access
must be assigned by an approved administrator through **Members & access**, with
a reason and audit history.

The frontend uses port 5173 and proxies `/api` to port 3100. `APP_ORIGIN` must
exactly match the browser's frontend origin, default `http://localhost:5173`.
The development proxy expects API port 3100.

Members register, complete their profiles, and wait for approval. Administrators
verify identity and email ownership through a trusted lab channel before approval.
Academic “Supervisor” never grants application privileges. Automatic verification
emails and password-reset emails are not configured.

`db:seed` adds instrument configuration, never accounts or sample records. Repeating
it preserves edits and archives. Initial “available” values are **unverified
configuration**, not live operating state or free booking slots. Review statuses,
limits, policies, training names, and buffers before operational use.

## Vercel deployment

`vercel.json` builds the Vite client and routes `/api/*` to the Node function in
`api/index.ts`. Vercel requires a **Neon PostgreSQL connection** in the server-only
`DATABASE_URL` environment variable. The function refuses to use local storage.

Set the production `APP_ORIGIN` to the exact HTTPS domain. Run database migrations,
seeding, and administrator bootstrap as explicit operator steps; builds and
function cold starts do not mutate the schema or create accounts. See the
[deployment guide](docs/deployment.md) for exact steps and preview isolation.

Phases 1 and 2 are deployed at https://quemat-app.vercel.app. Phase 3A requires
`003_weekly_progress.sql` in the isolated preview database before its health check
can pass. Phase 3A production release requires the [guarded fresh-backup and
migration procedure](docs/phase-3a-release.md) before merge/deployment.

## Built local server

```sh
npm run build
APP_ORIGIN=http://localhost:3100 npm start
```

This serves the compiled frontend and API together for local verification. Keep
`NODE_ENV` unset (or `development`) for a local PGlite database. Production requires HTTPS and
`DATABASE_URL` and cannot silently fall back to development storage.

## Validation

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

In the cloud environment, use the existing browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

API/browser tests use temporary PostgreSQL databases and synthetic accounts,
separate from development and hosted data. Browser tests cover desktop and phone
workflows, keyboard focus, and automated accessibility checks. CI is configured in
`.github/workflows/ci.yml`; see [progress](docs/progress.md) for verified runs.

## Phase boundaries

1. **Implemented:** foundation, accounts, approval, instrument register.
2. **Deployed:** samples, database-protected reservations, measurement details, check-in
   and completion.
3. **3A implemented for review:** weekly reports, revisions, scoped review, follow-ups
   and meeting summaries. Issues, announcements and meeting scheduling remain deferred.
4. Chemical orders and incoming external samples.
5. Facility calls and proposals.
6. Server-scheduled reminders, PWA installation, and release verification.

Defaults: **Asia/Kolkata** and **INR**. Never commit credentials, lab records,
contact data, database exports, or private attachments.
