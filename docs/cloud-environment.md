# Reusable cloud development environment

Use the existing checkout at `/workspace/QuEMat-App` with Node.js 24. Each cloud
task is isolated; do not create another checkout or worktree unless requested.
Read `README.md`, `docs/progress.md`, `docs/deployment.md`, and any applicable
`AGENTS.md` before starting. Phase 1 targets Vercel and Neon; later phases require
a separate request.

## Installation script

The tested installation script is [scripts/cloud-install.sh](../scripts/cloud-install.sh).
Use its complete contents as the cloud environment's `install_script`, or run:

```sh
bash /workspace/QuEMat-App/scripts/cloud-install.sh
```

Stop any process using the local PGlite database before running the script. It
preserves an existing `.env`, installs the locked dependencies, builds the app,
and migrates/seeds only the local development database. Explicit environment
overrides prevent these database commands from selecting Neon. It creates no
accounts and never overwrites existing instrument edits. Do not delete data or
lock files to bypass a running database process.

## Startup instructions

Use this section as the environment's `start_skill`. Installed dependencies and
compiled output may survive a snapshot; running processes do not. If dependencies
need refreshing, run `npm --cache /workspace/.cache/npm ci` at the repository root.
Preserve existing files and secrets.

Start the credential-free local development services and keep them running:

```sh
cd /workspace/QuEMat-App
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 NODE_ENV=development LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/postgres APP_ORIGIN=http://localhost:5173 npm run dev
```

The frontend uses port 5173 and proxies API requests to port 3100. Verify
`/api/health` returns `{"status":"ok"}`, `/api/session` reports an anonymous
session, and unauthenticated `/api/instruments` returns 401. Do not present a
loopback URL as a publicly accessible preview.

If the local database is absent, stop your services and run the migration and
seed commands from the installation script before restarting. PGlite permits
one owning process; stop the local server before CLI database commands. Seeding
creates the 15 supplied instrument configurations and no accounts. A trusted
operator can create the first administrator with the interactive `admin:create`
command. Never request a password in chat, hardcode one, or log it.

Validate from the repository root:

```sh
npm run build
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

The last command uses the cloud image's Chromium. On another machine, install
Playwright Chromium and omit the executable override. Browser tests use port
3199 and isolated temporary PostgreSQL data with synthetic accounts. These
checks do not validate a live Vercel deployment or Neon connection.

## Saving and publishing the environment

The installation script and startup instructions have also been saved as a cloud
environment configuration draft. Review and save that draft in the cloud
environment settings, then publish the environment to activate the configuration
and snapshot. Saving a draft alone does not publish it. Fresh-task restoration
has not yet been verified. This process is separate from deploying to Vercel.

No credentials are needed for local development. For hosted setup, follow
[deployment.md](deployment.md): use a server-only `DATABASE_URL`, the exact HTTPS
`APP_ORIGIN`, and separate preview databases. Never prefix credentials with
`VITE_`. Hosted migrations, seeding, and first-administrator creation are explicit
operator steps, never build or function-startup tasks. Check existing provider
bindings before creating resources; enter secrets through private settings, not
chat. Do not claim a live deployment without verifying it.
