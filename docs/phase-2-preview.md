# PR #1 preview setup

Use `feature/phase-2-bookings`, existing Vercel project `quemat-app`, and the
dedicated **QuEMat PR1 Preview** Neon project below. Do not clone production data,
reuse production passwords, apply the production `neon.ts` policy, or run the
ordinary `npm run db:*` commands for this procedure.

## Live preview status

Preview: https://quemat-app-git-feature-phase-2-bookings-govindjocose-2552.vercel.app

The isolated database was initialized from the user's Windows checkout: both
migrations, 15 instrument seeds, four original synthetic accounts and two initial
samples were confirmed. The user set the synthetic administrator's password
privately. No administrator password was supplied to the agent or recorded here.

The feature branch was deployed to the existing Vercel **Preview** target and
redeployed to verify persistence. The verified deployment is
`dpl_Ckr5hscapdbKUT2UL3NmKQVqDCsq`, source `bbbf774965106988c0972497c3396ae1dacd8513`.
The stable branch alias was verified to point to that new deployment.

Actual live checks passed:

- `/api/health`: HTTP 200 with `{"status":"ok"}`. This queries the hosted migration
  table; subsequent sample and booking writes/readbacks also confirmed database
  connectivity through Vercel's unchanged `pg` driver and verified TLS.
- Synthetic-member login; session cookies are Secure, HttpOnly and SameSite=Strict.
  API responses use `no-store`; cross-origin writes are denied.
- Unique sample creation (`QEM-3`), shared visibility and denied cross-owner edits.
- Detailed PPMS booking, operator/sample snapshots and confirmed scheduled status.
  An overlap returns 409; simultaneous live requests produce exactly one 201 and
  one 409. Another member cannot cancel the reservation.
- Cancellation is retained and the released interval can be booked again.
- Furnace temperature 1051 °C is rejected for the seeded 1050 °C furnace. Valid
  booking/check-in records actual usage. Completion without unloading returns 400
  and leaves it in progress; explicit unloading, summary and handover completes it.
- Pending members cannot access approved lab APIs. Role/status injection cannot
  self-approve an account. Approved members cannot manage members or instruments.
  Booking-change notifications persist in the private inbox.
- After redeployment: the existing session works without login, `QEM-3`, completed
  furnace state/actual end/handover, cancellation history and notifications remain.
  Logout then denies further protected access.

Three additional synthetic test accounts were registered through normal onboarding.
The user approved **Preview Checks Member** and **Preview Checks Other** as ordinary
members; **Preview Checks Pending** remains pending. No extra administrator was
created. Automation sessions were signed out and its temporary Vercel authentication
credential was revoked after checks. Deployment protection stays enabled.

The budget is ₹0: existing Neon/Vercel resources only, Vercel Hobby plan, basic
builds, no upgrades, paid features, trials, purchases or new infrastructure.
Production variables and deployment were compared with the baseline and unchanged;
production remains Phase 1 at `dc40148`. PR #1 is not merged.

Automated live browser screenshots were blocked by this cloud's proxy trust:
`ERR_CERT_AUTHORITY_INVALID` in Chromium at the preview hostname. Certificate
verification was not disabled. The live checks above used the trusted HTTPS API
client; earlier isolated desktop/phone tests are separate evidence. The user
successfully signed in and managed approvals in their own browser.

The new privately saved preview key has been verified. These resources now exist;
reuse them rather than creating another project, role or database:

| Resource | Preview value |
| --- | --- |
| Project | `sparkling-meadow-75486459` — QuEMat PR1 Preview |
| Branch | `br-patient-shape-a1fnddux` (named `production` within this separate preview project) |
| Region / PostgreSQL | Singapore / 18 |
| Role and database | `quemat_pr1_preview` |
| Direct endpoint | `ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech` |
| Pooled endpoint | `ep-old-haze-a1w10w9n-pooler.ap-southeast-1.aws.neon.tech` |

The role and initially empty database were created using only the preview project's API
key. Fresh credentials are stored in an ignored owner-only preview configuration;
no production credentials or account/data exports were used. Vercel Preview now
has branch-specific DATABASE_URL and APP_ORIGIN bindings for
`feature/phase-2-bookings`. Production bindings are unchanged.

Direct operator PostgreSQL access from this cloud workspace remains blocked. The guarded
preparation command, including an expanded-access attempt, fails with:

```text
EAI_AGAIN / getaddrinfo
ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech
```

Native DNS also fails for console.neon.tech and api.vercel.com; HTTPS API calls
work through the configured proxy. A PostgreSQL attempt through that proxy
terminated before queries. TLS verification and the application's pg driver were
preserved. New preview hostnames were saved in the environment network draft;
review/save/publish applies them, but actual transport must still be verified.
Windows initialization resolved the setup blocker. Vercel runtime connectivity
and persistence are verified above; direct cloud operator access is still not
established and must not be inferred from those runtime results.

Previously, production-project schema-only branching failed with HTTP 412 due to
a legacy `anonymous` web role. The separate preview project resolves that resource
creation blocker without modifying the production role or copying its data.

## Windows: isolated checkout and private configuration

Install Git and Node.js 24. Open a new PowerShell terminal. Run each block only
after the preceding block succeeds. This creates a separate checkout, with no
access to the production checkout's `.env` files.

```powershell
$ErrorActionPreference = 'Stop'
$previewCheckout = Join-Path $env:USERPROFILE 'QuEMat-PR1-Preview'
if (Test-Path $previewCheckout) { throw 'Choose a fresh preview checkout path.' }
git clone --single-branch --branch feature/phase-2-bookings https://github.com/govindjocose006/QuEMat-App.git $previewCheckout
if ($LASTEXITCODE -ne 0) { throw 'Clone failed.' }
Set-Location $previewCheckout
if ((git branch --show-current) -ne 'feature/phase-2-bookings') { throw 'Wrong branch.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Remove-Item Env:DATABASE_URL,Env:DATABASE_URL_UNPOOLED -ErrorAction SilentlyContinue
```

In **QuEMat PR1 Preview**, select the existing role and database
**`quemat_pr1_preview`** in Neon's Connect dialog when copying pooled and direct
URLs privately. Do not create duplicates. Its initial branch
may itself be named `production`; the new project, branch ID and endpoint must
all differ from real production. Copy no real accounts or lab data.

Create a protected directory and enter preview details below. Connection URLs
are hidden when pasted and do not become literal shell commands.

```powershell
New-Item -ItemType Directory -Path .preview | Out-Null
$previewIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls .preview /inheritance:r /grant:r "${previewIdentity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the preview directory.' }
function Read-PrivateValue([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $privatePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($privatePointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($privatePointer) }
}
$previewProject = 'sparkling-meadow-75486459'
$previewBranch = 'br-patient-shape-a1fnddux'
$previewHost = 'ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech'
$previewPooled = Read-PrivateValue 'Preview pooled URL for quemat_pr1_preview'
$previewDirect = Read-PrivateValue 'Preview direct URL for quemat_pr1_preview'
$previewFile = Join-Path (Get-Location) '.preview/.env.preview'
$previewLines = @(
  'PREVIEW_ONLY=quemat-pr1-synthetic'
  "PREVIEW_NEON_PROJECT_ID=$previewProject"
  "PREVIEW_NEON_BRANCH_ID=$previewBranch"
  "PREVIEW_NEON_HOST=$previewHost"
  "DATABASE_URL=$previewPooled"
  "DATABASE_URL_UNPOOLED=$previewDirect"
)
[IO.File]::WriteAllLines($previewFile, $previewLines, [Text.UTF8Encoding]::new($false))
Remove-Variable previewPooled,previewDirect,previewLines
git check-ignore .preview/.env.preview
```

The preview tool reads **only** the named file, ignoring ambient connection
variables and `.env`/`.env.local`. It rejects the known production project,
branch and endpoint; mismatched pooled/direct connections; and database names
other than `quemat_pr1_preview`. First preparation requires an empty database;
subsequent operations require its matching preview identity marker.

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview prepare
if ($LASTEXITCODE -ne 0) { throw 'Preview preparation failed; stop here.' }
node --import tsx scripts/preview-db.ts .preview/.env.preview fixtures
if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixtures failed; stop here.' }
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Preview connectivity verification failed.' }
```

This applies both migrations and the 15 instrument seeds, creates four synthetic
accounts (administrator, two approved members and one pending member), and two
synthetic samples. Instrument configuration comes from repository seeds, never a
production database export. Generated passwords are saved only in the ignored
private `.preview/.env.preview-accounts.json` file. Repeating fixtures does not
reset passwords or overwrite accounts/samples. No default password or public
bootstrap endpoint is introduced.

This initial setup has already been completed. Do not repeat `fixtures` now that
additional test accounts exist: its safety guard rejects accounts outside the
original four-account fixture set. For continued review, use `verify` and the
interactive `reset-password` command as needed; do not reset or recreate the database.

For your own preview sign-in, run this interactive command and select
**`preview-admin@example.test`**. Enter a unique password privately. This resets
only that synthetic account and revokes its sessions; never send passwords in chat.

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview reset-password
```

## Vercel Preview variables and deployment

Sign in with the account that owns the existing project. Decline creation of a
new Vercel project if `quemat-app` is inaccessible.

```powershell
npx vercel@65.0.0 login
npx vercel@65.0.0 link --project quemat-app
if ($LASTEXITCODE -ne 0) { throw 'Vercel linking failed.' }
$linkedPreviewProject = Get-Content .vercel/project.json -Raw | ConvertFrom-Json
if ($linkedPreviewProject.projectId -ne 'prj_Zc1EUGQUAfVDF2FJFJj5F1wsMc1W') {
  throw 'Wrong Vercel project.'
}
node --import tsx --input-type=module -e "import {previewConfig} from './scripts/preview-config.ts'; process.stdout.write(previewConfig('.preview/.env.preview').pooled)" |
  npx vercel@65.0.0 env add DATABASE_URL --environment preview --git-branch feature/phase-2-bookings --sensitive --yes
if ($LASTEXITCODE -ne 0) { throw 'Preview variable creation failed.' }
```

The URL flows directly into Vercel's stdin. If this exact branch Preview variable
already exists, confirm its scope and rerun that command with `--force`. Do not
upload the direct operator URL or alter Production variables.

The branch-specific **Preview APP_ORIGIN is already configured** as
`https://quemat-app-git-feature-phase-2-bookings-govindjocose-2552.vercel.app`.
Production APP_ORIGIN stays untouched. Visit this stable branch URL after the
Preview deployment assigns its aliases. Immutable deployment URLs will fail
Origin/CSRF for writes because this setup explicitly selects the branch origin.

```powershell
npx vercel@65.0.0 deploy --environment preview --yes
if ($LASTEXITCODE -ne 0) { throw 'Preview deployment failed.' }
$previewUrl = 'https://quemat-app-git-feature-phase-2-bookings-govindjocose-2552.vercel.app'
Start-Process "$previewUrl/api/health"
Start-Process $previewUrl
```

Deployment protection may first require your Vercel account sign-in. Then sign
into the app using `preview-admin@example.test` and the password set privately.
These are separate sign-ins. A protected health request may redirect an
unauthenticated command-line client; check health in the authenticated browser
instead of disabling protection.

## Live checks and persistence

These require the actual preview; local tests do not establish them.

1. `/api/health` returns HTTP 200 and `{"status":"ok"}`. The private `verify`
   command lists `001_foundation.sql`, `002_scheduling.sql`, 15 instruments,
   four accounts and two initial samples.
2. As `preview-member@example.test`, create a synthetic sample and PPMS booking
   with that member as actual operator. An overlapping booking must fail.
   Cancel the first booking; the released interval must become bookable again.
3. A furnace booking above the displayed maximum must fail. For a valid booking
   covering the current time, check in and attempt completion without unloading.
   It must remain in progress until explicit cooling/unloading confirmation,
   completion summary and handover notes are supplied.
4. In separate browser profiles, verify members cannot change instruments or
   other members' samples/bookings; the pending account cannot access the lab
   workspace. Obtain these synthetic passwords locally from the private account
   file; do not paste that file into chat.
5. Record the sample code and booking/handover state. Redeploy using the same
   Preview command and branch variable. Reopen the stable branch URL and verify
   those records and the signed-in session remain. The same hostname is retained;
   both records and sessions must persist in the preview database.
6. Rerun `verify` to confirm the selected database and persistent row counts.
   Record only checks actually completed and exact HTTP/network errors.

Do not merge PR #1, migrate production, or use Vercel's Production target. For
automated suites keep using the isolated databases in [phase-2.md](phase-2.md).
