# Deploy on Vercel with Neon PostgreSQL

The user selected Vercel and Neon for this app. The client is a Vite/React static
build, and `/api/*` runs through a Node.js Vercel Function. All persistent accounts,
sessions, rate limits, instruments, and audit history live in Neon PostgreSQL.
Nothing depends on a Vercel instance's filesystem or process staying alive.

## 1. Create the database

Create a Neon project in your account. Choose a region appropriate for the lab and
align the Vercel function region with the database to reduce latency. No paid plan,
region, project, or database has been created automatically.

Obtain the **pooled PostgreSQL connection string** from Neon for the Vercel runtime.
Use the direct connection string for operator tooling when recommended by Neon.
Keep both private. TLS certificate verification remains enabled by the app;
provider `sslmode` query parameters cannot disable it.

Use separate Neon databases/branches for production and previews. Never let
unreviewed preview code connect to the production database.

## 2. Prepare the database from a trusted terminal

Install Node 24 and dependencies. Store the selected Neon connection string in a
private local `.env` as `DATABASE_URL`, or inject it through your approved secret
manager. Do not put the value in Git, shell arguments, screenshots, logs, or chat.
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
