# Diagnose the held Phase 3A release

The user reported a successful private encrypted backup (52,259 bytes) followed
by a migration error without a type/code. Their SQL Editor check finds only 001
and 002; TCP 5432 was reachable in a subsequent Windows check. **The cause and
database outcome of that attempt are not established. PR #2 must remain unmerged
and production on Phase 2 until diagnosis, migration and verification succeed.**

The old generic output cannot retrospectively identify the failed stage. An open
TCP port does not establish TLS, PostgreSQL authentication or SQL success. The
SQL Editor uses a separate provider connection path. An absent ledger entry
does not prove all DDL/data was rolled back. Do not delete objects, reset a
password, disable TLS, extend timeouts or retry migration based on those facts.

**New evidence:** the user verified the retained archive's checksum and full
readability, with an age of 692 minutes when checked. Native Node diagnosis then
failed at `database.read_only.begin` with `AggregateError/ETIMEDOUT`, including
`ETIMEDOUT` and `ECONNREFUSED` attempts. This is connection-establishment failure;
no catalog result was obtained over that native connection. SQL Editor separately
shows the expected Phase 2 structure, with all checked 003 objects absent.

An isolated reproduction found an actual release-tool defect: a URL omitting its
port allowed `pg` to inherit ambient `PGPORT`, despite the target guard expecting
5432. With synthetic `PGPORT=15432`, the old actual pg client selected port 15432.
The Phase 3A config reader now pins **5432 in the in-memory URL itself**, leaving
the saved file/receipt unchanged, and an actual pg-client regression checks this
alongside verified TLS/host/role/database. This defect may explain the mismatch
with a PowerShell port-5432 test; the user's actual route is not considered fixed
until an authenticated, TLS-verified read-only Node query succeeds.

## Preserve the existing evidence

Retain the **same** private Phase 3A configuration, encrypted backup and receipt.
Do not rerun setup/backup in that folder, overwrite them, change `createdAt`, or
copy credentials into ordinary shell commands/chat. Keep the older Phase 2 backup
as well. The existing **24-hour freshness limit remains enforced for migration**.

Read-only diagnostics may inspect an expired archive/receipt; that is not
migration authorization. They print the original age and `backupFresh:false`
without refreshing anything. If expired, preserve it and stop for review. A new
backup in a new folder may be needed later, after the database state is understood.

## 1. Update code only

In the existing trusted release checkout, run separately, stopping on any error:

```powershell
git status --short
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch feature/phase-3a-weekly-progress
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Stop: pull failed.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
```

If the previous terminal is closed, restore only the saved private path:

```powershell
$phase3aConfig = Read-Host 'Path to the SAME existing private Phase 3A config file (not a connection URL)'
```

Do not run `migrate`, `backup`, `verify`, fixtures or general database commands yet.

## 2. Inspect the retained backup without accessing any database

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" inspect-backup
```

This reads the explicit configuration/receipt, validates its Phase 3A purpose,
pinned target/hash and encrypted-file checksum, and reports the original age,
freshness and presence/absence of a migration receipt. It does not decrypt,
connect, change timestamps, write a receipt or run a database migration. It never
authorizes migration, even when fresh. This check does not claim to revalidate
the decrypted archive's contents.

## 3. Recheck archive decryption/readability without accessing any database

Run this separately. Stop on an error and retain its sanitized output:

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" check-backup
```

Enter the **existing** backup passphrase at the hidden prompt. This uses the
existing free PostgreSQL 18 clients, decrypts only a uniquely named temporary
private copy, verifies the plaintext hash, and repeats archive-list/full-read
validation. It does not create a new backup, restore a database, modify the
encrypted archive/receipt, or make an expired backup fresh. Temporary plaintext
is removed normally; native tool output stays in the private local log. Do not
share that log or the files.

## 4. Inspect database structure read-only

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" diagnose
```

This validates the same explicit target/receipt/archive checksum, then runs one
catalog/count query inside an explicit **read-only, repeatable-read transaction**.
It requires no password entry beyond the existing private configuration. It
cannot run migration SQL or save/repair a receipt. Its output contains only:

- Expected database/role/PostgreSQL-version booleans.
- Presence of 001/002/003 and the number of unexpected ledger entries.
- Known weekly tables, functions, indexes, constraints and history triggers.
- The weekly notification column, booking-column nullability and source constraint.
- Existing Phase 2 overlap/actual-usage/buffer-trigger safeguards.
- Aggregate account/instrument/sample/booking/usage/notification/audit counts.

No database records, identifiers, names, passwords, URLs or arbitrary SQL error
messages are printed. Metadata and counts alone cannot prove original row-content
preservation; output deliberately says `rollbackProven:false` and
`migrationAllowed:false`. Even a structurally clean Phase 2 result is not an
automatic instruction to retry the migration.

Possible structure labels:

| Label | Meaning |
| --- | --- |
| `PHASE2_STRUCTURE_NO_003_OBJECTS` | Known 003 objects/notification changes absent, 001/002 safeguards present; rollback/content preservation still not proved |
| `PARTIAL_OR_UNEXPECTED_003_STATE` | Ledger and objects disagree, or expected constraints/triggers are incomplete; stop for investigation |
| `PHASE3A_STRUCTURE_PRESENT` | Ledger and expected 003 structure present; reconcile the private migration receipt and verify records before release |
| `UNEXPECTED_BASELINE` | Missing/unknown baseline migration or Phase 2 safeguard; stop |

### If the Node connection still fails

Run the **single SELECT** in [phase3a-release-state.sql](../scripts/phase3a-release-state.sql)
through Neon's SQL Editor with the verified production `neondb` selected. To copy
only that public, static SQL from the Windows checkout:

```powershell
Get-Content scripts\phase3a-release-state.sql -Raw | Set-Clipboard
```

Paste it into SQL Editor and run it. It performs no DDL/DML and returns the same
known schema metadata and aggregate counts. The expected-role boolean may differ
if SQL Editor uses another role; do not grant/change privileges to make it true.
This result checks the SQL Editor path, not native Node/PostgreSQL connectivity.

## 5. Return safe outputs and wait

### Native connectivity follow-up (no migration)

After updating to the tested correction, first rerun `inspect-backup` using the
**same** private file to get the current original age and the actual boolean
`receiptHasMigrationRecord`. Keep the complete safe JSON values when reporting.
The age of 692 minutes was measured earlier; it is not a new expiry timestamp.

Then compare Node's default, IPv4-only and IPv6-only TCP paths:

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" network-check
```

This pins the production hostname and TCP 5432, sends no credentials or SQL, and
does not perform a TLS/PostgreSQL handshake. It reports Node/platform/address
selection settings, address-family counts, sanitized attempt outcomes and timing.
It indicates only whether `PGPORT` is present/matches 5432, never its raw value
or resolved addresses. Unavailable families are skipped. A TCP success is still
**not** a working PostgreSQL connection.

Test the fixed target with the ordinary **read-only** command:

```powershell
node --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" diagnose
```

If that still returns connection timeout/refusal **and** `network-check` shows
IPv4 reachable, compare this single-process address-selection variant:

```powershell
node --no-network-family-autoselection --dns-result-order=ipv4first --import tsx scripts/phase3a-production-release.ts "$phase3aConfig" diagnose
```

These Node flags do not persist environment/system changes, change the hostname,
hard-code an IP, change the 10-second pg timeout, disable TLS verification or
execute migration SQL. Success must include expected database/role/version,
read-only catalog state and metadata. If both Node TCP profiles fail while a
contemporaneous PowerShell check to the same hostname/5432 succeeds, review
process-specific firewall/VPN/network rules with the machine's trusted operator;
do not disable controls. If native SQL remains unsuccessful, stop and return
the safe results. Do not switch to an unreviewed SQL Editor migration route.

The network/driver regression tests use fake DNS and real isolated loopback
sockets; no production connection is made by automated tests. Node flag behavior
was checked locally. The dependency audit/corrections are documented in
[the security review](phase-3a-dependency-review.md).

Send only JSON output from `inspect-backup`, `check-backup` and `diagnose`, plus
the SQL Editor metadata result if necessary. Never send the backup, receipt,
configuration, passphrase, connection URL, log, database records or session cookie.

Failures now identify a fixed `stage`, whitelisted `errorType`/`code`, sanitized
cause codes, and the pinned hostname. Errors without codes still show a stage
and type; recognized connection timeouts get a safe classification. Messages,
stacks, SQL, details and paths are omitted. If rollback reporting masks a prior
SQL error, the original sanitized failure is retained separately. A lost commit
acknowledgement is treated as uncertain; a known successful commit followed by
receipt-write failure is explicitly identified. No error output alone claims a
complete rollback.

Do **not** retry production migration until the outputs are reviewed and the
isolated tests/CI for any proposed fix pass. Neither missing ledger entries nor
successful TCP connectivity bypasses the backup, freshness, target, hash,
preservation, migration-receipt or deployment gates. Budget stays ₹0; production
deployment and preview remain unchanged.
