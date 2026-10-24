# Phase 3C production release — guarded preparation

The user accepted the tested preview on **2026-10-25 (Asia/Kolkata)**: meetings,
attendee privacy, notes, actions, calendar export, explicit notice reading and a
new acknowledgement after corrections. These are **user-confirmed live preview
results**, separate from automated isolated/native/browser test evidence.

Authorization now covers preparing/pushing this tooling and guide, the automatic
isolated-preview redeployment, waiting for all CI, and **Windows checkout and
dependency/type-check preparation only (step 1)**. It does **not** authorize private
configuration setup, production diagnostics, a production backup, migration, merge
or production deployment. Later steps below are a reviewable future runbook, not
permission to execute them. PR #6 stays open; do not start Phase 4.

Budget is strictly **₹0**. Reuse the existing Neon production database, existing
Vercel Hobby project, installed free PostgreSQL 18 clients and private local disk.
Do not purchase, enable trials, upgrade, create cloud snapshots/branches/databases/
storage/infrastructure or activate paid integrations. The public repository's
standard hosted CI uses free Linux/Windows runners and only synthetic local data.

## Pinned target and independent authorization

| Setting                 | Required value                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| Existing Neon project   | `wandering-truth-11355959`                                          |
| Production branch       | `br-flat-band-a1umhh3i`                                             |
| Direct hostname         | `ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech`               |
| Database / role / port  | `neondb` / `neondb_owner` / **5432**                                |
| Required baseline       | 001 foundation, 002 scheduling, 003 weekly progress, **004 issues** |
| Only permitted addition | `005_meetings_notices.sql`                                          |
| Reviewed LF SHA-256     | `edec82141df539734e79d90d694b8ec09977f9171e058283de80ffbefe543d59`  |
| Configuration purpose   | `quemat-phase3c-production`                                         |
| Backup receipt purpose  | `quemat-phase3c-production-backup-v1`                               |

Use `phase3c-production-release.ts`, not the still-pinned 002/003/004 tools. Earlier
configs/receipts/backups cannot authorize 005. Preserve every existing backup,
receipt and private release directory; no relabelling, copying/editing timestamps
or substituting a preview config. This CLI never loads `.env`, `.env.local` or
ambient DATABASE_URL. It requires an explicit private file outside **all** Git
checkouts. The URL pins host/database/role/port, verifies TLS and channel binding,
and cannot be redirected by PGPORT/URL options. Native clients receive a sanitized
PG environment, private password file, verified TLS and fixed identity.

No general `db:migrate`, seed/fixture script, account reset, membership change,
restore, merge or deployment belongs to this migration command. Builds/cold
starts do not run SQL. The existing 005 SQL and application behavior are unchanged
by this release preparation, including optional issue-status reasons.

## 1. First authorized Windows preparation step

Use the trusted **release** checkout `C:\Users\Govind Unnikrishnan\QuEMat-App`, not
the separate preview checkout. Run `git status --short` first and stop for local
changes/conflicts; do not reset/stash/delete them automatically. Then run each
command separately, stopping on any failure:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch feature/phase-3c-meetings-notices
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
git rev-parse HEAD
```

If the feature branch does not exist locally, use `git switch --track
origin/feature/phase-3c-meetings-notices` instead of `git switch`. Compare the
printed commit with the exact reviewed green head provided in chat. Do not proceed
if they differ. Node must be version 24:

```powershell
node --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
npm run typecheck:release
if ($LASTEXITCODE -ne 0) { throw 'Stop: release type checks failed.' }
```

**Stop here under the current authorization.** Report the commit, Node version,
dependency/audit and type-check results only. This step selects code/dependencies
and does not connect to a database, create private credentials or touch backups.

## 2. Future: new private configuration, only after separate authorization

Do not reuse `$phase3bConfig` or any older release directory. New setup creates a
unique ACL-restricted `%LOCALAPPDATA%\QuEMat\phase3c-release-...` folder outside
Git, without touching the old folders. Keep archives/receipts/passphrases private.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase3c-production-release-setup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: private setup failed.' }
$phase3cConfig = Read-Host 'NEW private Phase 3C config path printed above (not a connection URL)'
```

Reuse `C:\Program Files\PostgreSQL\18\bin` if that is the existing installed free
client location. Select the fixed production branch/database/role in Neon's
Connect dialog and enter its current **direct** URL only at the hidden local
prompt. Do not share it, reset passwords or edit Vercel variables. Setup invokes
offline preflight: target/purpose/migration hash/client versions and
`databaseAccessed:false`. This is not connectivity or backup proof. ExecutionPolicy
Bypass affects this child process only, not persistent machine settings.

## 3. Future: read-only native connectivity and clean 004 baseline

```powershell
node --import tsx scripts/phase3c-production-release.ts "$phase3cConfig" diagnose
if ($LASTEXITCODE -ne 0) { throw 'Stop: diagnosis failed. Do not back up or migrate.' }
```

Require the expected database, role, PostgreSQL 18 and public schema; migrations
001–004, no unknown ledger entries, all old booking/weekly/issue safeguards and
`PHASE3B_STRUCTURE_NO_005_OBJECTS`. It runs a read-only repeatable-read transaction
and returns only known metadata/counts. It always says `migrationAllowed:false`,
`rollbackProven:false`: catalogs/counts do not prove complete rollback or original
row preservation. Missing 005's ledger alone is never enough to approve a retry.

On native connection failure, keep only safe stage/type/code/hostname. The optional
`network-check` action compares fixed-host default/IPv4/IPv6 TCP without credentials
or SQL; TCP success is not TLS/authentication/SQL proof. Do not disable TLS, change
passwords or route the migration through SQL Editor. The single read-only
`scripts/phase3c-release-state.sql` may be inspected in Neon SQL Editor with
production **neondb** selected; that verifies only that separate connection path.
Partial objects, unexpected history or inconsistent receipts require state review.

## 4. Future: fresh encrypted backup using existing free local clients

```powershell
node --import tsx scripts/phase3c-production-release.ts "$phase3cConfig" backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup failed. Do not migrate.' }
```

Only after separate authorization, enter/confirm a new strong passphrase (at least
20 characters) at hidden prompts and keep it separately. The command checks the
clean pre-005 identity/schema, takes a consistent custom-format PG18 `pg_dump`,
encrypts with AES-256-GCM/scrypt, decrypts a private verification copy, compares
hashes, runs `pg_restore --list` and **reads the full archive to temporary SQL**.
This does not restore a database or create a cloud resource. It verifies archive
encryption/readability, not a restore drill. Temporary plaintext/password files
are removed normally; after interruption inspect the private folder locally.
Never upload that folder or its native-tool logs.

Require `backup:"ENCRYPTED_AND_VERIFIED"`, `fullArchiveRead:true`, positive
`encryptedBytes` and `credentialsPrinted:false`. Archive/initial receipt creation
is exclusive; an existing receipt causes refusal rather than replacement. The
new archive and receipt must be retained alongside all previous release backups.

Age starts at the receipt's original timestamp **before pg_dump starts**. Migration
requires **strictly less than 24 hours**, checked again after validation/connection
and inside the locked transaction immediately before DDL. Inspections, decrypting,
verification and retries do not refresh age. Expired backups stay preserved; stop
for state review before preparing a new independent backup/config folder. A
post-005 backup cannot be relabelled as the required pre-005 backup.

## 5. Future: inspect, then apply only 005 after separate authorization

```powershell
$phase3cInspection = node --import tsx scripts/phase3c-production-release.ts "$phase3cConfig" inspect-backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup inspection failed.' }
$phase3cInspection
$phase3cBackup = ($phase3cInspection | ConvertFrom-Json -ErrorAction Stop).backup
if ($phase3cBackup.backupFresh -ne $true -or $phase3cBackup.receiptHasMigrationRecord -ne $false) {
    throw 'Stop: expired backup or existing migration evidence. Preserve files and review state.'
}
```

Inspection checks the encrypted checksum and original age; it does not decrypt,
connect or modify files. `encryptionReadability:"NOT_RECHECKED"` is expected.
`check-backup` separately repeats hidden-passphrase decryption/full archive read
without a database or receipt-time change, if authorized and needed.

Only after review of successful prerequisites and separate migration authorization:

```powershell
node --import tsx scripts/phase3c-production-release.ts "$phase3cConfig" migrate
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not retry, merge or deploy.' }
```

Use the existing new Phase 3C backup passphrase privately. The tool repeats
hash/decryption/full-read/freshness/identity and pinned SQL validation. In one
transaction it takes the app write lock and freezes writes to **all 22 existing
tables**, including auth writes. Before/after full canonical hashes compare every
existing account, instrument/config/training/SOP, sample, booking/actual usage/
unloading/handover/allocation, notification, audit/session/rate/ledger row,
weekly draft/revision/comment/review/action event, and issue/current status/optional
reason/history/discussion. Composite identities and both sample/issue numbering
sequences are preserved. Only the two new NULL notification columns are normalized;
old `issue_id` and weekly/booking source/content remain compared.

All nine new meeting/notice tables must be empty: **no production fixtures**.
The ledger insert and exact 005 schema checks happen in the same transaction,
including named validated constraints/definitions, column types/nullability/defaults,
indexes, exact trigger-function bodies, enabled triggers, exclusive five-source
notifications and all old booking/weekly/issue safeguards.

Require `migration:"APPLIED"`, `recordPreservation:"PASSED"`, equal before/after
counts and `fixturesRun:false`. Preserved ledger counts intentionally exclude only
new 005, so they show **4**; later verification lists all **5** migration names.
No production data/account/instrument seed is added or replaced.

## 6. Future: verify retention before any merge/deployment

```powershell
node --import tsx scripts/phase3c-production-release.ts "$phase3cConfig" verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: verification failed. Do not merge or deploy.' }
```

Require `backup:"VERIFIED"`, names 001–005, `originalRecords:"RETAINED"`,
`constraints:"VERIFIED"`, `fixturesRun:false`. Verification uses a read-only
repeatable-read snapshot. Immediate migration equality covered every old row;
later verification preserves original domain identities, immutable issue/weekly/
audit/ledger/comment/notification content and known first weekly submission/issue
acknowledgement identities/timestamps. Legitimate new records, current draft/issue/
booking updates, notification reads and auth cleanup are allowed. Any missing or
altered immutable history blocks release. Verification rechecks the encrypted
archive checksum but does not claim a new decryption/restore drill.

On any error, stop and share **only sanitized JSON** stage/type/code/hostname.
Never paste credentials, archives, receipts, private logs or preservation hashes.
Primary errors are retained separately from rollback/close failures, and commit
acknowledgement is distinguished from uncertain outcome. A lost commit reply or
receipt-write failure is not proof of rollback. Existing 005 without this receipt's
successful evidence, or a migration receipt with absent 005, blocks blind retry.
No drop/restore/ledger repair/retry or age reset happens automatically.

## 7. Future merge/deployment/private acceptance — not authorized

After successful operator backup, guarded migration, preservation verification,
exact-head CI and **separate release authorization**, use the existing project/Git
integration to merge PR #6 and deploy. Preserve Production variables and older
preview bindings, pg driver, authentication/approval controls and free plans.
Then check live health, deployed commit and protected access. The user signs in
privately to verify existing instruments/bookings/weekly/issues and a labelled
meeting/notice/read-correction flow. Retain test history; no real physical usage,
new privileged accounts or credentials in chat. No Phase 4 is included.

## Preparation validation and limits

Local tests use populated synthetic PGlite databases and fake encrypted byte
archives, never production records or URLs for connections. Existing native CI
tests the guarded 005 application on a fresh random loopback PostgreSQL 18 database
with populated Phase 3B history. Windows CI exercises the real CLI's offline path
with a TCP-blocking preload and synthetic private files; it parses setup scripts
without executing interactive credential setup. These checks do not constitute a
Windows production backup, restore drill or production connectivity proof. Actual
published CI results must pass at the exact head before providing step 1; see
[progress](progress.md) and PR #6. No production backup/migration has run for 005.
