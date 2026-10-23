# Phase 2 production release: private Windows operator steps

**Release completed on 2026-10-23:** the user ran the private backup, migration and
verification below successfully on Windows. Existing records were retained. After
all PR checks passed, PR #1 was merged at `4d34d5408207babb78d6cfa59108dfa872287534`
and deployed to https://quemat-app.vercel.app. See [progress.md](progress.md) for
the verification evidence, including the user's successful private administrator
sign-in and production sample/booking check.

The steps below record the one-time Phase 1-to-Phase 2 procedure and recovery
material. Retain the existing encrypted backup and receipt; an already migrated
database cannot produce a pre-Phase-2 backup. The release required successful
backup, migration, verification and CI before merge/deployment. Native cloud
PostgreSQL DNS failed with `EAI_AGAIN/getaddrinfo`, so database operations were
performed in the trusted Windows terminal. Vercel runtime connectivity is healthy.

Budget: ₹0. Reuse the existing Neon database and Vercel Hobby project. Do not
create a branch, snapshot service, database, server, trial or paid backup service.
The backup uses local disk and free PostgreSQL clients and Node cryptography.
Keep the separate PR preview database and its Vercel bindings unchanged.

## 1. Check the target and prerequisites

| Setting | Required production value |
| --- | --- |
| Neon project | `wandering-truth-11355959` |
| Branch | `production` / `br-flat-band-a1umhh3i` |
| Direct host | `ep-round-rain-a1orsgna.ap-southeast-1.aws.neon.tech` |
| Database | `neondb` |
| Role | `neondb_owner` |
| Vercel project | `quemat-app` |
| Production origin | `https://quemat-app.vercel.app` |

Use the Windows checkout on `feature/phase-2-bookings`, Node 24 and Git. The
release commands never load ordinary `.env` files or ambient DATABASE_URL values.
Do not use `db:migrate`, `db:seed`, preview commands or fixtures for this release.

Have the **free PostgreSQL 18 client tools** `pg_dump.exe` and `pg_restore.exe`
available, normally in `C:\Program Files\PostgreSQL\18\bin`. If absent, obtain
free Windows binaries through [PostgreSQL's official Windows download page](https://www.postgresql.org/download/windows/).
Extract/install only the local client tools; no running local server or cloud
resource is required. Do not accept a paid offer or trial. Both client versions
are checked before database access; older clients cannot back up PostgreSQL 18.

In PowerShell, from that checkout, run each block separately and stop on failure:

```powershell
git switch feature/phase-2-bookings
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
```

## 2. Create a private release configuration

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\production-release-setup.ps1
if ($LASTEXITCODE -ne 0) { throw 'Stop: private setup failed.' }
$releaseConfig = Read-Host 'Paste only the private config path printed above'
```

The execution-policy override applies only to that child process. The setup asks
for the PostgreSQL 18 `bin` directory and the **current production direct
connection URL**, entered with hidden input. Get it privately from Neon's Connect
dialog for the exact target above; select the direct connection, not pooling.
Never paste the URL into chat or a normal shell command. No password reset is
needed. The Vercel runtime retains its existing pooled connection.

The script creates a unique directory under `%LOCALAPPDATA%\QuEMat`, outside Git,
restricts its ACL to your Windows identity, and writes the private configuration
there. The final printed path contains no credentials. Preflight must report the
target above, PostgreSQL 18 clients, and `databaseAccessed:false`. It has not yet
made a backup or queried the database. Do not move this folder into the checkout,
a shared folder, or public/cloud-synced storage.

## 3. Back up production first

```powershell
node --import tsx scripts/production-release.ts "$releaseConfig" backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup failed. Do not migrate or release.' }
```

Enter and confirm a unique backup passphrase of at least 20 characters through
the hidden prompts. Store it privately, separately from the backup. Losing it
makes the encrypted backup unrecoverable. Never send it to the agent.

This runs a consistent, custom-format `pg_dump` of the existing database with
verified TLS and a temporary protected password file. It encrypts the archive
with AES-256-GCM and a scrypt-derived key, decrypts a verification copy, compares
SHA-256 hashes, and runs both `pg_restore --list` and a complete archive read to
temporary SQL. Temporary plaintext archives, SQL and password files are removed
on normal success/failure. They remain inside the private folder if the process
is forcibly interrupted; inspect that folder privately before resuming.

Success reports `backup:"ENCRYPTED_AND_VERIFIED"`, `fullArchiveRead:true`, and a
positive `encryptedBytes`. Keep the encrypted `.dump.enc`, private receipt and
configuration together. A verified encrypted receipt is required for migration.
No hosted snapshot or new infrastructure is created. This checks all archive
data is readable; **it is not a full restore into another PostgreSQL database**.

## 4. Apply only the reviewed Phase 2 migration

```powershell
node --import tsx scripts/production-release.ts "$releaseConfig" migrate
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not merge or deploy.' }
```

Enter the backup passphrase privately again. Before connecting for migration,
the command verifies the encrypted receipt, decrypts the archive and repeats its
full-read/hash validation. It pins the target and reviewed `002_scheduling.sql`
hash (normalizing Git for Windows CRLF). It requires the existing Phase 1 schema,
15 seeded instrument identities and an approved administrator.

The command applies only the additive scheduling migration in a transaction,
including `btree_gist`, overlap exclusion, booking guard and active-usage index.
It compares existing users, instruments, training, SOPs and audit records before
and after inside that transaction and rolls back on any change. It creates no
accounts, instruments, fixtures or samples. Success reports `migration:"APPLIED"`
(or `ALREADY_APPLIED` on a safe repeat), `recordPreservation:"PASSED"`, equal
before/after counts, and `fixturesRun:false`. Do not edit or delete old records.

## 5. Verify and hand back the results

```powershell
node --import tsx scripts/production-release.ts "$releaseConfig" verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: verification failed. Do not release.' }
```

Success reports both `001_foundation.sql` and `002_scheduling.sql`,
`originalRecords:"RETAINED"`, `constraints:"VERIFIED"`, instrument counts and
`fixturesRun:false`. Send **only the sanitized JSON success outputs** from
backup, migrate and verify. Do not send credentials, archive contents, the receipt
or `private-tool.log`. On failure, stop and share only the safe error message /
code and hostname printed by the command; inspect the private tool log locally.

Wait after verification. The agent will check PR CI, merge PR #1 and use the
existing Vercel production deployment only after these results are confirmed.
The additive migration leaves Phase 1 operating while the release is pending.
The agent will verify live health and request private administrator sign-in for
authenticated checks if needed. No automated test suite will run on production.
Any smoke-check data will be identified, with only those new test records cleaned
up using the application's supported lifecycle and historical audit retained.

## Recovery material

Retain the private folder and separate passphrase until the release is verified
and the lab's backup-retention policy permits disposal. To recover a native
archive later, from the same reviewed checkout:

```powershell
node --import tsx scripts/production-release.ts "$releaseConfig" decrypt-backup
if ($LASTEXITCODE -ne 0) { throw 'Stop: backup decryption failed.' }
```

This validates and decrypts into a uniquely named private `.dump` beside the
receipt. It does **not** restore or change any database. A database restore needs
a separately reviewed target and recovery procedure; never blindly restore over
production or copy real records into the synthetic preview. This release does
not start Phase 3.
