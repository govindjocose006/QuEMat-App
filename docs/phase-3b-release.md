> Historical preparation runbook: Phase 3B backup, migration 004, preservation
> verification and the separately authorized PR #4 production release have now
> succeeded. PR #5 later changed optional reasons without a migration. See
> [progress](progress.md). Preparation-only statements below describe the earlier
> authorization stage; do not rerun migration/backup commands for deployment.
> Existing encrypted backups/receipts remain private and unchanged. Phase 3C's 005
> is preview-only and cannot be authorized by this pinned 004 tooling.

# Phase 3B production release — preparation only

**Authorization is limited to publication, automatic preview redeployment and
Windows checkout preparation (step 1).** The user accepted preview assignment,
acknowledgement, progress and resolution. They authorized publishing the prepared
tooling and waiting for all CI, including native PostgreSQL and Windows syntax
checks, before providing the first Windows preparation step.

**Do not run production backup/migration, merge PR #4 or deploy production.**
Steps 2 onward remain a future runbook requiring separate authorization. No fresh
production backup has been created for Phase 3B. Existing Phase 2/3A backups and
receipts stay untouched. No credentials are required for step 1.

The prepared tooling is published to the existing
`feature/phase-3b-issues-requests` branch, which automatically redeploys only its
configured isolated preview. The exact latest head must pass all checks before
step 1. An accepted preview or a published tool does not authorize later release
operations. Do not execute the remaining blocks merely because they appear here.

Budget remains **₹0**: use the existing Neon production database and Vercel Hobby
project, existing free PostgreSQL 18 clients, and private local disk. No cloud
snapshot, new branch/database/project, paid storage, trial, upgrade or purchase.

## Fixed target and migration

| Setting                   | Required value                                                     |
| ------------------------- | ------------------------------------------------------------------ |
| Neon organization         | `org-ancient-moon-23673941`                                        |
| Existing project / branch | `wandering-truth-11355959` / production (`br-flat-band-a1umhh3i`)  |
| Direct host               | `ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech`              |
| Database / role / port    | `neondb` / `neondb_owner` / **5432**                               |
| Baseline migrations       | 001 foundation, 002 scheduling, **003 weekly progress**            |
| Only permitted addition   | `004_issues_requests.sql`                                          |
| Reviewed LF SHA-256       | `2093f0203026ff677fd89366dba244e6ef7880141d7f45f441b15e2711ed44bc` |
| Configuration purpose     | `quemat-phase3b-production`                                        |
| Backup purpose            | `quemat-phase3b-production-backup-v1`                              |
| Existing production app   | https://quemat-app.vercel.app (`quemat-app`, currently `ec8a4fe`)  |

Use the separate `phase3b-production-release.ts` tool. The older Phase 2 and
Phase 3A tools deliberately remain pinned to 002/003; do not modify their pins
or reuse their configurations/receipts for 004. No seed, fixture, general
`db:migrate`, account reset or membership change belongs in this release.

The tool reads **only** an explicit private configuration outside all Git
checkouts. `.env`, `.env.local`, injected DATABASE_URL and PGPORT cannot select
another target; the validated URL pins 5432 in memory. The pg driver, certificate
verification and channel binding remain enabled. Native dump clients receive a
sanitized PG environment, fixed target and `verify-full` TLS.

## Release gates — checkout preparation now, remaining execution later

After separate release authorization, the agent must check PR #4's exact head,
application diff, CI/security audit, and existing Vercel plan/configuration.
Application code remains the tested preview; release-tool changes need their own
review/CI. Required hosted checks include the populated-003 guarded-004 native
PostgreSQL test and Windows script syntax parsing, not merely the earlier 004
application tests. No automated suite may point at production.

Then a trusted operator follows the small Windows steps below. Stop on every
error. Never send passwords, connection strings, session cookies, private logs,
configuration, backup archives or receipts in chat. Return only the safe JSON
outputs. Keep preview and production checkouts/configurations separate.

### 1. Update the trusted Windows release checkout

These commands may be provided after this published preparation passes exact-head CI.
They select code and dependencies only; they do not connect to any database.
Start with `git status --short`; stop for local changes/conflicts, without reset.
Run each separately:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch feature/phase-3b-issues-requests
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
git rev-parse HEAD
```

If the branch does not exist locally, use `git switch --track
origin/feature/phase-3b-issues-requests` instead of `git switch`. The agent must
confirm that the printed commit is the exact reviewed green release head.

```powershell
node --version # Node 24
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependencies failed.' }
npm run typecheck:release
if ($LASTEXITCODE -ne 0) { throw 'Stop: release type check failed.' }
```

### 2. Create a NEW private Phase 3B configuration, not a backup yet

Preserve every previous private release directory, archive and receipt. Do not
copy/edit an old receipt or reset its creation timestamp. Use a new directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase3b-production-release-setup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: private setup failed.' }
$phase3bConfig = Read-Host 'Path to the NEW private Phase 3B config printed above (not a connection URL)'
```

Setup creates a unique `%LOCALAPPDATA%\QuEMat\phase3b-release-...` directory
outside Git and restricts its ACL to the current Windows identity. Reuse the
installed free PostgreSQL 18 `bin` directory. Enter the current production
**direct** connection URL only at the hidden prompt, obtained privately from
Neon's Connect dialog for the fixed target above. No password reset or Vercel
variable change is needed. The policy override affects only this PowerShell
child, not the machine's persistent execution policy.

Offline `preflight` validates target/purpose, migration hash and PostgreSQL 18
client versions. It reports `databaseAccessed:false`; this is **not** connectivity
or backup proof. If the tools are unavailable, stop and resolve the existing
free local client setup; do not enable a paid backup service.

### 3. Establish native SQL connectivity and a clean baseline read-only

This action does not require a backup receipt:

```powershell
node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" diagnose
if ($LASTEXITCODE -ne 0) { throw 'Stop: native diagnosis failed. Do not back up or migrate yet.' }
```

Require `expectedDatabase:true`, `expectedRole:true`, `postgres18:true`,
`publicSchema:true`, migrations 001/002/003, no unknown migrations, intact weekly
and booking safeguards, and `PHASE3A_STRUCTURE_NO_004_OBJECTS`. The output is
known schema metadata and aggregate counts only, with `migrationAllowed:false`
and `rollbackProven:false`. Counts/catalogs alone never prove row preservation
or complete rollback of an earlier attempt.

If native connectivity fails, retain the safe JSON stage/type/code/hostname.
`network-check` compares default/IPv4/IPv6 TCP 5432 without credentials or SQL:

```powershell
node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" network-check
```

TCP success does not prove TLS, authentication or SQL access. Resolve native
access without disabling TLS/firewalls, changing passwords or extending timeouts.
The single read-only `scripts/phase3b-release-state.sql` can be run in Neon's SQL
Editor with production **neondb** selected if needed; this validates that separate
connection path only. Do not use SQL Editor to bypass the guarded migration.
Partial 004 objects, an existing 004 ledger or unexpected baseline require review;
never drop objects, repair the ledger or run fixtures to make checks pass.

### 4. Create and verify a fresh encrypted pre-004 backup

The old Phase 3A backup cannot substitute for this new backup, even if its age
were under 24 hours: it has another purpose/hash and predates new weekly records.

```powershell
node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup failed. Do not migrate.' }
```

Enter/confirm a new strong passphrase of at least 20 characters at hidden prompts;
store it privately and separately. The command checks production identity and
a clean 003 baseline, takes a consistent custom-format `pg_dump`, encrypts using
AES-256-GCM with scrypt, decrypts a private verification copy, compares hashes,
and runs `pg_restore --list` plus a **full archive read** to temporary SQL. No
restore, cloud backup service or resource creation occurs. Temporary plaintext
and password files are removed normally; after forced interruption, inspect the
private directory locally. Never upload its contents or `private-tool.log`.

Success must include `backup:"ENCRYPTED_AND_VERIFIED"`, `fullArchiveRead:true`,
positive `encryptedBytes`, `credentialsPrinted:false`. Archive creation and the
initial receipt are exclusive; an existing receipt/folder is not overwritten.
This verifies encryption/readability, **not** a restore drill. The archive and
receipt remain outside Git and must be retained with the earlier backups.

The original receipt time is recorded **before pg_dump starts**, conservatively
representing backup age. Migration requires **less than 24 hours from that time**;
encryption/validation/inspection/retry never refresh it. If expired, preserve all
material and stop for state review before making another backup in a new folder.
A backup taken after 004 cannot be relabelled as the required pre-004 backup.

### 5. Inspect the same receipt, then apply only 004

Only after the previous gates and separate release authorization, run this block:

```powershell
$phase3bInspection = node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" inspect-backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup inspection failed.' }
$phase3bBackup = ($phase3bInspection | ConvertFrom-Json -ErrorAction Stop).backup
$phase3bInspection
if ($phase3bBackup.backupFresh -ne $true -or $phase3bBackup.receiptHasMigrationRecord -ne $false) {
    throw 'Stop: backup not fresh or migration evidence already present. Preserve files and review state.'
}
node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" migrate
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not retry, merge or deploy.' }
```

Enter the existing **Phase 3B backup** passphrase at its hidden prompt. The tool
repeats encrypted/plaintext checksums and full archive validation, verifies the
pinned SQL and exact identity/baseline, and checks freshness before/after connecting
and again **inside the locked transaction immediately before DDL**.

The transaction takes the app write lock and freezes writes to all 19 preserved
tables, including auth/session writes. Full canonical row hashes before/after
must match for:

- Accounts, instruments, training, SOP links, audit and write lock.
- Samples, bookings/actual usage/unloading/handover, sample links and availability.
- Existing booking/weekly notifications, sessions, rate limits and original ledger.
- Weekly reports/private drafts/first timestamps, all revisions, comments,
  reviews and follow-up action history, including composite keys.

Only the new NULL `notifications.issue_id` is normalized; existing weekly source
columns remain fully compared. Sample numbering is unchanged. New issue tables
must be empty. No accounts, samples, issues, bookings, seeds or fixtures are added.
The 004 ledger insert, notification compatibility checks, validated constraints,
indexes, exact reviewed issue trigger-function bodies and enabled history/identity
triggers are verified together with all existing weekly/booking safeguards.
Unexpected differences normally abort/roll back the transaction. Any failure
still requires read-only outcome review; a lost commit acknowledgement or receipt
write failure must not be treated as proof of rollback.

Success must show `migration:"APPLIED"`, `recordPreservation:"PASSED"`, equal
before/after counts and `fixturesRun:false`. Ledger fingerprints/counts deliberately
exclude only the newly added 004 row, so the preserved ledger count is **3**;
the following verification lists all **4** migrations.

### 6. Verify preservation before merge/deployment

```powershell
node --import tsx scripts/phase3b-production-release.ts "$phase3bConfig" verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: verification failed. Do not merge or deploy.' }
```

Require `backup:"VERIFIED"`, all four migration names,
`originalRecords:"RETAINED"`, `constraints:"VERIFIED"`, and `fixturesRun:false`.
Immediate migration equality covers every original row; later verification keeps
original domain identities and immutable audit/ledger/weekly history, comment
content, notification content/source and known first-submission timestamps.
Legitimate new reports/revisions, draft edits, follow-up completion, notification
reads and session/rate-limit cleanup are allowed. Missing records or altered
immutable history block release and need review.

Return only safe success/error JSON, preserving actual true/false values. Do not
share the archive, receipt, hashes/IDs inside private preservation evidence, logs,
configuration or credentials. Wait for the agent to review these outputs and
recheck CI; do not merge or deploy on the basis of command completion alone.

## Failed or uncertain attempts

Stop after any failure. `inspect-backup` checks the existing encrypted hash/age
without a database; `check-backup` repeats decryption/full-read using the hidden
existing passphrase and private temporary files, without connecting to a database.
Neither modifies the original archive/receipt or resets age. `diagnose` is an
explicit read-only SQL transaction and does not need a receipt. All errors expose
only fixed stages, whitelisted types/codes and the hostname, never raw messages,
SQL, records, credentials, stacks or paths.

An existing 004 without this receipt's successful preservation evidence blocks a
blind retry. Conversely, a migrated receipt with a missing 004 ledger is an
inconsistency, not permission to reapply. Known prior success can be verified;
only a reviewed retry with the original fresh successful receipt can report
`ALREADY_APPLIED`. Never edit receipt timestamps/purpose/evidence to force that
path. A new failure after a known commit can identify commit acknowledgement;
otherwise database outcome remains unestablished by the error alone.

## Later merge, deployment and private acceptance

**Not authorized now.** After a separate release authorization and all successful
backup/migration/verification and exact-head CI gates, merge PR #4 at the reviewed
head and deploy via the existing Vercel Git integration/project. Preserve all
Production variables, app authentication, pg driver, approval controls, preview
bindings and free plans. No schema work runs during build/cold start. No rollback
or production restore is automatic; recovery requires separate state review.

Then verify the canonical URL's health (004 ledger through Neon), deployed commit,
protected access and existing instruments/records. The user signs in privately
with the existing production account to check Phase 2/3A and a clearly labelled
issue assignment/acknowledgement/progress/resolution history, then resolves only
the test issue. Do not create production accounts, change privileges or record
physical instrument usage merely to test. Keep issue history; do not delete it.
No Phase 3C, attachments, paid integrations, purchases or background/email/push
reminders are part of this release.

## Preparation validation and limits

Local guarded-release tests use populated synthetic PGlite PostgreSQL databases;
the standard native CI test is extended to exercise the same guard on its fresh
random loopback PostgreSQL 18 database. CI also parses Windows setup scripts
without executing them. The Linux preparation workspace has no native PostgreSQL
18 clients or PowerShell installed; the added native/Windows checks run in the
existing hosted CI after the now-authorized publication. Confirm their actual
results at the exact head before providing step 1; do not assume them passed. No real production backup, migration or native production SQL check has
been run during preparation. See [progress](progress.md) for actual local results.
