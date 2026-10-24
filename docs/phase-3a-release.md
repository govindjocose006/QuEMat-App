# Phase 3A production release: private Windows steps

**Release hold after the first migration attempt:** the user reported successful
backup, but migration failed with insufficient diagnostics and 003 is absent
from the ledger. Preserve the existing backup/receipt. Follow
[read-only diagnosis](phase-3a-release-diagnostics.md) before any migration retry;
the missing ledger alone does not establish full rollback.

The user accepted the tested preview and authorized release of PR #2. **Do not
merge or deploy until this fresh backup, migration, verification and final CI
have succeeded.** The existing Phase 2 production app continues to run while
these prerequisites are pending. No Phase 3B/3C is authorized.

Budget: ₹0. Reuse the existing Neon production database, Vercel Hobby project,
local disk and already installed free PostgreSQL 18 client tools. No cloud
snapshot/branch, service, infrastructure, upgrade, trial or purchase is needed.
Keep the existing Phase 2 encrypted backup and its private directory untouched.

## Target and authorization

| Setting | Required value |
| --- | --- |
| Neon project | `wandering-truth-11355959` |
| Branch | `production` / `br-flat-band-a1umhh3i` |
| Direct host | `ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech` |
| Database / role | `neondb` / `neondb_owner` |
| Vercel project | existing `quemat-app` |
| Production URL | https://quemat-app.vercel.app |
| Allowed migration | `003_weekly_progress.sql` only |
| Reviewed LF SHA-256 | `d2a89110a6e746c6e34023a382dc953124886728c50e6c2c41a58f9a24cec696` |

The old `production-release.ts` remains pinned to Phase 2. **Do not use it for
this release.** The new `phase3a-production-release.ts` has an independent purpose,
migration pin, pre-Phase-3A history checks and receipt. It reuses the tested
encryption and PostgreSQL-client safety mechanics, not Phase 2 authorization.
Ordinary `.env` files and ambient database URLs cannot select its target.

## 1. Update the trusted release checkout

Use your existing trusted Windows production/release checkout, keeping the
separate preview checkout unchanged. Start with a clean working tree. Stop if
Git reports conflicts/local work that would be overwritten; do not reset it.

```powershell
git status --short
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch --track origin/feature/phase-3a-weekly-progress
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed. See note below.' }
```

If that local branch already exists, use this block instead of `git switch --track`:

```powershell
git switch feature/phase-3a-weekly-progress
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
```

```powershell
node --version # Must be Node 24
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
npm run typecheck:release
if ($LASTEXITCODE -ne 0) { throw 'Stop: release-tool type check failed.' }
```

The agent checks CI for this exact branch head before proceeding. Do not run
`db:migrate`, `db:seed`, `fixtures`, `weekly-fixtures` or any automated tests
against production.

## 2. Create a NEW private backup directory/configuration

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase3a-production-release-setup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: Phase 3A setup failed.' }
$phase3aConfig = Read-Host 'Paste only the NEW private config path printed above'
```

The setup creates a unique `%LOCALAPPDATA%\QuEMat\phase3a-release-...` folder
outside Git, restricts its ACL to your Windows identity, and prompts for:

- The existing PostgreSQL 18 `bin` folder, normally
  `C:\Program Files\PostgreSQL\18\bin` (`pg_dump.exe` and `pg_restore.exe`).
- The **current production direct connection URL**, entered with hidden input.
  Obtain it privately from Neon's Connect dialog for the exact target above.
  Do not change the database password or Vercel variables.

Never enter a connection URL as an ordinary shell argument or share it in chat.
The new config must say `RELEASE_PURPOSE=quemat-phase3a-production`. An old Phase 2
config/receipt or the preview target is rejected. Do not select the previous
backup folder or overwrite any old archive/receipt.

Offline preflight must show migration 003, the hash above, PostgreSQL 18 clients,
and `databaseAccessed:false`. The execution-policy override affects only this
child PowerShell process. No database has been changed at this step.

## 3. Make the fresh encrypted backup

Run this block by itself and stop on failure:

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup failed. Do not migrate or release.' }
```

Enter/confirm a new backup passphrase of at least 20 characters through hidden
prompts. Store it privately and separately from the archive. Do not send it here.

The command verifies the production identity/version and existing 001/002 ledger,
then uses a consistent custom-format `pg_dump`, verified TLS and a temporary
private password file. It encrypts using AES-256-GCM and a scrypt-derived key,
decrypts a verification copy, compares SHA-256 hashes and runs `pg_restore --list`
plus a complete archive read to temporary SQL. No running local server or new
cloud resource is needed. Recovery compatibility uses the same encrypted format
as the tested Phase 2 backup, with a distinct Phase 3A receipt.

Success JSON must include `backup:"ENCRYPTED_AND_VERIFIED"`,
`fullArchiveRead:true`, positive `encryptedBytes`, and `credentialsPrinted:false`.
The new archive has a unique `quemat-before-phase3a-...dump.enc` name. Exclusive
creation and a separate folder preserve the old backup. Temporary plaintext and
password files are removed on normal completion/failure; inspect this private
folder locally after a forced interruption. Never share its contents or log.

This verifies the archive's full readability and encryption roundtrip. It is
**not** a restore drill into another database. No production restore is performed.

## 4. Apply only migration 003

The backup must be less than 24 hours old when migration starts. If it expires
before migration, create a new Phase 3A folder/backup; preserve the older one.

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" migrate
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not merge or deploy.' }
```

Enter the new backup passphrase privately again. The tool checks the receipt,
target, migration hash, freshness, encrypted/decrypted checksums and full archive
read before database migration. It requires the exact production database/role,
PostgreSQL 18, migrations 001/002, the 15 original instrument seed identities and
an approved administrator. It does not initialize or repair missing baseline data.

Inside one transaction, it takes the application write lock and briefly blocks
table writes, fingerprints every existing row and applies only the pinned SQL.
It checks full content preservation of users, instruments, samples, bookings
(including actual usage, outcome and handover), sample associations, allocated
windows, notifications, training, SOPs, audit history, sessions, rate limits,
write-lock row and the original migration ledger. The new NULL notification-source
column is the sole normalized difference. Sample numbering is retained. Any
unexpected difference rolls the migration back.

It verifies weekly uniqueness/week checks, revision/review foreign keys,
append-only history triggers and notification compatibility, as well as existing
Phase 2 overlap/buffer/actual-usage safeguards. It creates no reports, accounts,
samples, bookings, seeds or fixtures. Phase 2 remains compatible during the gap
before merge/deployment.

Success must report `migration:"APPLIED"`, `recordPreservation:"PASSED"`, equal
before/after counts and `fixturesRun:false`. A safe retry with the same verified
receipt reports `ALREADY_APPLIED` without recreating data. Do not use a new backup
after 003 to pretend it is the required pre-migration backup.

## 5. Verify, then send only sanitized results

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: verification failed. Do not release.' }
```

Success must include `backup:"VERIFIED"`, all three migrations,
`originalRecords:"RETAINED"`, `constraints:"VERIFIED"`, and `fixturesRun:false`.
Post-migration verification checks original stable domain IDs and immutable
audit/ledger content. It permits legitimate later record updates/new activity
and expired-session/rate-limit cleanup; full row equality was checked atomically
during migration, rather than assuming a live database stays frozen afterwards.

Send only the success JSON from **backup, migrate and verify**. Never send the
config, receipt, passwords, archive, real records or `private-tool.log`. On error,
stop and share only the safe error/code/hostname printed by the tool. No merge or
production deployment may happen until these results and final CI succeed.

## 6. Deployment and private production acceptance

After the successful prerequisites, the agent merges the exact green PR head
and lets the existing Vercel Git integration deploy `main`. Production variables
and the isolated preview bindings are preserved. No schema change runs in a
build or cold start.

The agent checks live health (003 ledger through Neon), deployed code and denied
anonymous access. Then, sign in privately with your existing production account:

1. Confirm all 15 instruments, existing Samples/Calendar and your previous records.
2. For a small Phase 2 check, create an identifiable synthetic sample and a future
   PPMS booking in an empty slot, refresh, cancel the booking and archive the
   sample. Do not check in or record physical usage for this release check.
3. Open Weekly Progress for the current IST week. If you already have a real
   report, preserve it and choose an unused earlier week for this smoke check.
   Save a clearly labelled synthetic draft, reload, review/submit, then make and
   submit one correction. Verify both revisions and the first timestamp remain.
   Keep the test report/history identified; reports are append-only and should
   not be deleted to conceal the check. Do not create synthetic production users
   or change real membership privileges just to test reviewer roles.
4. Confirm Sign out is visible and ends access. Reply with results and only the
   new test IDs if visible. Do not share your password or session cookie.

Reviewer-role permission tests and user acceptance already passed in the isolated
preview. Additional real reviewer validation needs an existing authorized reviewer
using their own private account. Never select an academic role to grant permission.

## Private recovery material

Keep both Phase 2 and Phase 3A encrypted backups and their separate receipts,
configurations and passphrases. To recover a native archive without restoring:

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" decrypt-backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup decryption failed.' }
```

This exclusively creates a unique private recovery `.dump`; it cannot overwrite
an existing destination and does not modify any database. A production restore
requires a separately reviewed recovery procedure. Do not copy real production
records into the synthetic preview. No Phase 3B/3C is started by this release.
