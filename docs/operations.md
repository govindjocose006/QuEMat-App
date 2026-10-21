# Administration, backups, and recovery

## Development and database selection

Use Node 24 and `npm ci` in the repository root. Copy `.env.example` only if `.env`
does not already exist. With no `DATABASE_URL`, CLI/server commands use local
PGlite PostgreSQL under `data/postgres/`. Stop the server before CLI commands;
PGlite is single-process. Runtime data and `.env` are ignored by Git.

`npm run db:migrate` applies numbered migrations. `npm run db:seed` adds the supplied
instruments idempotently without creating accounts or resetting administrator
edits. Local server startup also checks migrations. Hosted startup/builds do not:
run migrations explicitly against the selected Neon database before deployment.

For Vercel configuration and production/preview separation see
[deployment.md](deployment.md). An unset hosted connection must fail; it must
never select a temporary database to make the site appear to work.

## First administrator and access approval

1. A trusted operator runs `npm run admin:create` against the intended database.
   Enter the real administrator's email, a hidden strong password, confirmation,
   and name. Never place credentials in arguments, Git, logs, screenshots, or chat.
2. Sign in and review instrument configuration. Initial statuses are unverified.
3. Members register and complete onboarding, including mentor selection or a
   pending assignment for interns/Master's students.
4. Verify identity and email ownership through a trusted lab channel. Use
   **Members & access** to approve, recording the reason.
5. Grant privileged application roles only after separate authorization. Academic
   roles never grant privileges. Consider a second trusted administrator to avoid
   access depending on one person.

Deactivation revokes access while preserving history and flagging mentees for
reassignment. Archive instruments instead of deleting them. The last active
administrator cannot be deactivated/demoted, even by simultaneous requests.

## Password recovery

No email provider or automatic reset email is configured. Verify identity out of
band, then run `npm run account:reset-password` from a trusted terminal connected
to the correct database. It prompts for the email and hidden replacement password,
revokes sessions, and audits the reset without changing permissions. Deliver the
replacement through an approved secure channel; members should change it under
**My account**. It does not reactivate a departed member.

## Hosted Neon backups and exports

Configure Neon's backup/restore retention for the chosen plan and run recovery
drills. Branching and point-in-time restore availability depend on the Neon plan;
no backup policy or restore schedule has been provisioned here.

For a portable full PostgreSQL export, use a compatible `pg_dump` with Neon's
**direct** connection endpoint. Supply host, database, username, and TLS settings
through PostgreSQL environment variables/service configuration, and the password
through a protected `PGPASSFILE` (mode 0600) or an approved secret manager. Do not
place a password-bearing URL in command-line arguments.

```sh
# PGHOST, PGDATABASE, PGUSER and PGPASSFILE must already be configured privately.
PGSSLMODE=verify-full pg_dump --format=custom --file=/secure/backup/quemat.dump
```

This contains private emails, password hashes, sessions, and audit history. Encrypt
and restrict exports, store them outside the checkout, and apply retention. Later
private-object-storage attachments will need coordinated file/metadata backups;
no attachment uploads exist in Phase 1.

To recover, restore into a **separate** Neon branch/database using the correct
application revision and compatible PostgreSQL tooling. After verifying the
restore, revoke restored sessions before directing traffic to it:

```sh
# Environment/service settings must target the isolated restore database.
PGSSLMODE=verify-full pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$PGDATABASE" /secure/backup/quemat.dump
PGSSLMODE=verify-full psql --command='DELETE FROM sessions;'
```

Verify migration history, record counts, administrator login, instruments, and
audit history before switching Vercel's `DATABASE_URL` and redeploying. Keep the
prior database and a rollback plan until the restore is accepted. Do not reseed
or reset to hide missing data. Actual hosted restore has not been tested here.

## Local development export/recovery

Stop the local server. `npm run db:backup -- /private/backup/local-postgres.tar.gz`
creates a protected PGlite development export and refuses to overwrite existing
files. This is **not** a pg_dump file and cannot be imported directly into Neon.

To restore into a new local development directory, use PGlite's `loadDataDir`:

```sh
node --input-type=module -e '
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync } from "node:fs";
if (existsSync(process.argv[3])) throw new Error("Choose a new restore directory");
const db = await PGlite.create({ dataDir: process.argv[3],
  loadDataDir: new Blob([readFileSync(process.argv[2])]) });
await db.query("DELETE FROM sessions");
await db.close();
' /private/backup/local-postgres.tar.gz /private/restore/postgres
```

Set `LOCAL_DATABASE_PATH` to the restored directory and keep `DATABASE_URL` empty.
Start locally and inspect the restored records. Local persistence, export, and
reopening the export are exercised by automated tests; this does not validate
Neon backups or a real deployment disaster-recovery procedure.
