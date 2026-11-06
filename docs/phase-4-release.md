# Phase 4 production release — guarded operator workflow

Release status: PR #8 merged as `df0049c` on 2026-10-25 (Asia/Kolkata), following
user acceptance of the isolated preview and explicit production release
authorization. The Windows operator completed backup, migration 006 and verify;
production deployment is READY and private production acceptance remains pending.
Keep this guide as the record of the guarded process. Do not rerun completed
setup/backup/migration steps. Neither this guide nor passing CI authorizes a new
migration, merge, deployment or restore.

## Independent authorization

Only `006_chemical_orders.sql` is allowed, with reviewed normalized SHA-256
`05c585263f5a8c4cca896b5cf704411f1a3798048d69c24502ecfb179eb4e926`.
The expected new catalog has an independent pinned digest; tables/columns/defaults,
constraints/validation, indexes, sequence parameters and function/trigger definitions
must match the reviewed schema. Existing 001–005 history and safeguards must pass.
Unknown migrations, partial states and 006 without this receipt's migration
preservation evidence block the CLI. No repair or uncertain retry is automatic.

The new Phase 4 private config and backup receipt use independent purpose values.
Earlier scripts, purpose values, receipts and archives stay unchanged and cannot
authorize 006. The direct production target is inherited from the already verified
production guard; Preview/pooler/wrong-database/wrong-role targets are rejected.
PostgreSQL 18 server/clients, verified TLS and explicit port 5432 remain required.
Ambient `.env`, `.env.local` and `PGPORT` cannot select a different target.

## What the migration verifies

All 31 original tables are locked and fingerprinted by full original row content
inside the migration transaction, including sessions/authentication, actual usage,
weekly revisions/reviews, issues/history, selected meeting attendees, notes/actions,
notice revisions and revision-specific acknowledgements. Only the new null order
notification column and new 006 ledger entry are excluded from before/after hashes.
Existing sample/issue sequence state must be unchanged. New chemical tables must
be empty and new numbering unconsumed; no fixtures, seeds or accounts are created.

Later verify checks original stable records and immutable history while allowing
legitimate mutable content and volatile session/rate-limit cleanup. Schema/counts
alone do not establish row preservation or prove a failed migration rolled back.
No backup restore, cloud snapshot, extra database or paid resource is automatic.

## 1. Trusted Windows RELEASE checkout — not the preview checkout

Use the existing `QuEMat-App` checkout, Node 24 and free PostgreSQL 18 tools.
Preserve local changes and previous private config/password/backup files. Run one
block at a time, stopping on any error. Start with:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $env:USERPROFILE 'QuEMat-App')
$changes = git status --porcelain
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Stop: checkout must be clean. Preserve changes.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git show-ref --verify --quiet refs/heads/feature/phase-4-chemical-orders
if ($LASTEXITCODE -eq 0) {
    git switch feature/phase-4-chemical-orders
} elseif ($LASTEXITCODE -eq 1) {
    git switch --track origin/feature/phase-4-chemical-orders
} else { throw 'Stop: branch inspection failed.' }
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only origin feature/phase-4-chemical-orders
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Stop: commit inspection failed.' }
node --version
```

Confirm that HEAD is the exact reviewed, green CI commit provided in the release
conversation and Node is v24 before continuing. If this clone does not fetch that
branch, stop for guidance; do not switch to the preview checkout.

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: installation failed.' }
npm.cmd run typecheck:release
if ($LASTEXITCODE -ne 0) { throw 'Stop: release type check failed.' }
```

Stop and report preparation success before private setup. No database was accessed.

## 2. New private Phase 4 setup and offline preflight

Only after preparation has been reviewed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase4-production-release-setup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: private setup failed.' }
$phase4Config = Read-Host 'Paste only the NEW private Phase 4 config path printed above'
```

Use your existing PostgreSQL 18 bin directory. Select the same verified production
Neon project/branch/database/role as previous releases, with pooling off. Paste the
current direct connection URL only into the local hidden prompt. The exact target
is checked offline. New restricted directories are outside Git and preserve all
older artifacts. Share only sanitized preflight JSON (`databaseAccessed:false`),
never a connection URL, config/path/file, credential, receipt, archive or private log.

## 3. Read-only diagnosis, then stop for state review

```powershell
node --import tsx scripts/phase4-production-release.ts "$phase4Config" diagnose
if ($LASTEXITCODE -ne 0) { throw 'Stop: diagnosis failed. No backup or migration.' }
```

Expected clean state is `PHASE3C_STRUCTURE_NO_006_OBJECTS`, 001–005 present, 006
absent, no unknown history and all earlier safeguards intact. Review actual
identity booleans and state. Diagnosis does not validate a backup or authorize
migration. A network failure can be investigated with the diagnostic-only
`network-check` action; never weaken TLS, change hosts or use a pooled URL.
If outcome is uncertain, preserve all evidence and stop; metadata never proves
complete rollback or original record preservation.

## 4. Fresh independent encrypted backup — separately authorized

```powershell
node --import tsx scripts/phase4-production-release.ts "$phase4Config" backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup failed. Preserve evidence; do not retry automatically.' }
```

Privately enter/confirm a new passphrase of at least 20 characters and store it
separately. Local `pg_dump` uses a consistent MVCC snapshot. The archive is encrypted,
decrypted for roundtrip comparison and read completely by PostgreSQL 18 pg_restore.
This is archive validation, not a full restore drill. Previous backups/receipts
stay untouched. Success is `ENCRYPTED_AND_VERIFIED`, `fullArchiveRead:true`, positive
encrypted byte count and `credentialsPrinted:false`. Stop and share only safe JSON.

## 5. Inspect original age and wait for review

```powershell
node --import tsx scripts/phase4-production-release.ts "$phase4Config" inspect-backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: inspection failed.' }
```

The original age must be **under 24 hours** (`backupFresh:true`) and migration
receipt explicitly absent (`receiptHasMigrationRecord:false`). Diagnostic
`migrationAllowed:false` is expected. Inspection does not refresh the clock or
recheck decryption. Optional `check-backup` performs offline decrypt/full-read
validation with the existing passphrase; it does not connect to a database.
If expired, preserve everything and stop. Do not edit/refresh receipts, overwrite
backups or bypass guards. A fresh backup needs a newly reviewed private setup.

## 6. Migration 006 only — separately authorized after evidence review

```powershell
node --import tsx scripts/phase4-production-release.ts "$phase4Config" migrate
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not retry, merge or deploy.' }
```

Enter the existing Phase 4 backup passphrase privately. Before DDL, the command
rechecks archive/decryption/full read, original age, pinned target/SQL/catalog,
baseline, locks and backup freshness again inside the locked transaction. Full
row equality and old numbering are checked before commit. Success adds migration
evidence to the same new receipt, preserving the archive and original timestamp.
A commit/receipt-write error or 006 without this receipt's preservation evidence
requires outcome review; do not rerun blindly or manually insert the ledger row.

## 7. Verify before merge or deployment

Only after successful migration:

```powershell
node --import tsx scripts/phase4-production-release.ts "$phase4Config" verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: verification failed. Do not release.' }
```

Expected: backup verified, migrations 001–006, original records retained, constraints
verified and `fixturesRun:false`. Share only sanitized backup/inspection/migrate/
verify JSON, not private evidence files. No merge/deployment occurs from these
scripts. Obtain the separate release authorization after operator verification and
final CI; retain the accepted synthetic preview and all earlier environment bindings.

After an authorized application release, verify live health/version, protected
access and private production acceptance without inventing physical instrument
usage or real purchases. Costs remain records only; the application never places
orders, cancels supplier orders, makes payments or refunds.
