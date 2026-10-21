# PR #1 preview setup

Use `feature/phase-2-bookings`, existing Vercel project `quemat-app`, and a **new
empty Neon project** dedicated to this preview. Do not clone production data,
reuse production passwords, apply the production `neon.ts` policy, or run the
ordinary `npm run db:*` commands for this procedure.

## Current cloud blocker

The available Neon key is scoped to project `wandering-truth-11355959`. It cannot
list/create separate projects (HTTP 404: actions outside its scope are forbidden).
Schema-only branch creation failed at `console.neon.tech` with HTTP 412:

```text
project with a legacy web access role do not support schema-only branches; role:"anonymous"
```

No preview branch was created. Removing a production role or cloning a
data-bearing branch is not a workaround. In Neon, create **QuEMat PR1 Preview**
with Postgres only (Singapore if available). Save its project-scoped API key
privately as cloud secret `NEON_PREVIEW_API_KEY` and provide only the project ID
in chat. Review/save/publish the environment to apply that secret. New endpoint
and deployment hostnames may also need allowlisting. API access and actual
PostgreSQL transport connectivity are separate checks.

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

In the **new preview project**, create a new Postgres role `quemat_pr1_preview`
and an empty database **`quemat_pr1_preview`** owned by that role. Select them in
Neon's Connect dialog when copying the pooled and direct URLs. Its initial branch
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
$previewProject = Read-Host 'NEW preview project ID'
$previewBranch = Read-Host 'NEW preview branch ID (br-...)'
$previewHost = Read-Host 'NEW direct endpoint hostname (no -pooler, scheme or path)'
$previewPooled = Read-PrivateValue 'NEW pooled URL for quemat_pr1_preview'
$previewDirect = Read-PrivateValue 'NEW direct URL for quemat_pr1_preview'
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

Leave **Preview APP_ORIGIN unset** so the app uses its exact generated HTTPS
`VERCEL_URL`. Production APP_ORIGIN stays untouched. Check the dashboard for a
global Preview APP_ORIGIN and remove only its Preview binding if present. Use
the **immutable URL** printed by deployment; other aliases will fail Origin/CSRF.

```powershell
npx vercel@65.0.0 deploy --environment preview --yes
if ($LASTEXITCODE -ne 0) { throw 'Preview deployment failed.' }
$previewUrl = (Read-Host 'Exact immutable https://...vercel.app deployment URL').TrimEnd('/')
if ($previewUrl -eq 'https://quemat-app.vercel.app') { throw 'Production URL is forbidden.' }
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
   Preview command and branch variable. Sign in at the **new immutable URL** and
   verify those records remain. Browser cookies are hostname-specific, so a new
   immutable hostname requires sign-in even though sessions live in PostgreSQL.
6. Rerun `verify` to confirm the selected database and persistent row counts.
   Record only checks actually completed and exact HTTP/network errors.

Do not merge PR #1, migrate production, or use Vercel's Production target. For
automated suites keep using the isolated databases in [phase-2.md](phase-2.md).
