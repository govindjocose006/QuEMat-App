# Phase 3A: Weekly Progress

Implemented for review and isolated preview on `feature/phase-3a-weekly-progress`.
[PR #2](https://github.com/govindjocose006/QuEMat-App/pull/2) is open.
The user accepted the preview and authorized production release subject to the
[guarded backup/migration procedure](phase-3a-release.md) and final CI. Production
remains Phase 2 until those prerequisites succeed. No paid service, trial or
additional infrastructure is permitted.

## Writing and submitting

Open **Weekly Progress** and select a week. Weeks run Monday 00:00 through the next
Monday 00:00 in **Asia/Kolkata**, with the ending instant excluded. Dates are shown
as a Monday–Sunday range. Timestamps are stored in UTC and displayed in IST.
Current and earlier weeks are supported, with one report per person/week.

The six sections are work completed, experiments/samples measured, main results,
blockers, next week's plan, and help/decisions needed. Drafts may be incomplete;
all sections are required for submission (use “None” when appropriate). Save a
draft before leaving the page. Draft content is private to its author.

Select relevant bookings and samples explicitly, then choose **Save and review
submission**. Read the complete summary and confirm it before submission. Bookings
are relevant when the author booked, operated or participated in them and their
scheduled or actual interval overlaps the week. Samples are eligible if owned by
the author or associated with those bookings. Archived samples remain selectable
for historical reporting. Nothing is automatically claimed as completed research.
Scheduled times, actual check-in/completion and status are separately labelled.

Submitted revisions snapshot the selected records, text and data links. Later
sample edits or booking changes do not rewrite history. If sources change between
review and confirmation, the server requires a new review. Editing a submitted
report creates a private revision draft; the previous submission remains visible
until the replacement revision is submitted. First submission time and every
revision timestamp are retained. Simultaneous/stale edits return a conflict.

Data links must be HTTP(S), without embedded credentials. Use independently
access-controlled destinations. The app does not fetch or grant access to the
linked data. File uploads await separately configured private storage.

## Review, missing reports and discussion

| Application permission | Access |
| --- | --- |
| Approved member | Own drafts, submissions, history and discussion; own follow-ups |
| Approved mentor or administrator | Own reports only |
| Approved supervisor | Submitted reports across the lab; own drafts |
| Pending, inactive or incomplete onboarding | No weekly workspace access |

An academic **Supervisor** role grants no review permission. Administrators assign
application permissions using the existing audited membership controls. As of the
28 October 2026 privacy policy, mentor assignment does not grant report access.
Only the supervisor reviews other authors. Nobody reviews their own report, and
reviewers cannot inspect other people’s draft content. Earlier release-validation
notes below describe the historical policy, which this policy supersedes.

Filter **Review weekly reports** by week, person and project. The missing roster
includes currently approved/onboarded members and mentors whose accounts existed
before the end of the selected week. Supervisors/administrators may submit, but
are not expected in the missing roster. Existing submissions from historical
inactive members remain visible within the current reviewer's scope. Submitted
project filters use the submitted project; missing rows use the current profile
project. This is current eligibility, not a reconstruction of historical membership.
“Not submitted” is not an overdue judgement: no reporting deadline is configured.

Reviewers comment, assign follow-ups to the report author (optional due date), and
mark a specific revision reviewed. Authors can reply. The author or current
reviewer can complete/reopen follow-ups; the state-change history is retained.
Comments and review acknowledgements remain attached to their original revision.
A new submission needs a new review. In-app notifications persist for submissions,
comments, reviews and follow-up changes. There are no background reminders.

The dashboard shows the current week, the user's report state/open follow-ups and,
for reviewers, scoped submitted/missing/awaiting-review counts. **Print meeting
summary** prints the filtered reports and discussion, expanding content and hiding
navigation/buttons. These counts describe workflow, not research quality. There
are no productivity rankings or booking-hour scores.

## Existing isolated preview

Reuse only the existing synthetic target:

- Neon project: `sparkling-meadow-75486459`
- Branch: `br-patient-shape-a1fnddux`
- Database: `quemat_pr1_preview`
- Direct host: `ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech`
- Existing Vercel project: `quemat-app`, Hobby plan

The new migration is additive, so the existing Phase 2 preview remains compatible
with this shared synthetic preview database. Production is a different database.
No production credentials or records are needed. No cloud resource is created.

The preview build is deployed at
https://quemat-app-git-feature-phase-3a-weekly-7e18d7-govindjocose-2552.vercel.app.
Migration 003 and synthetic fixtures were applied successfully from Windows. Live
health and member/report/booking API checks pass, including persistence across
redeployment. The user confirmed the private mentee/mentor/supervisor review,
comment, follow-up and printable-summary workflows. Local desktop/phone browser
checks and CI pass. Direct cloud Chromium still has a certificate-trust limitation;
see [progress](progress.md) for the separate validation evidence.

Sign in to Vercel if prompted, then use a synthetic app account. **Sign out** is
visible at the top-right on desktop and phone. Production passwords are never
needed for this preview.

### Windows operator steps if cloud PostgreSQL is blocked

Use the **existing separate preview checkout**, where `.preview/.env.preview`
already initialized the target above. Do not use the production checkout or copy
its `.env`. Run each block only after the preceding block succeeds:

```powershell
# First cd to your EXISTING preview checkout, not the production checkout.
git status --short
git fetch origin
git switch --track origin/feature/phase-3a-weekly-progress
```

If the local feature branch already exists, use
`git switch feature/phase-3a-weekly-progress` followed by `git pull --ff-only`.
Stop if Git reports local changes/conflicts; preserve them rather than resetting.

```powershell
node --version # Must be Node 24
npm ci
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
```

Confirm the hostname/database above. This tool reads only the explicitly named
preview configuration and checks its stored database identity; production `.env`,
`.env.local` and injected `DATABASE_URL` cannot select the target.

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview prepare
node --import tsx scripts/preview-db.ts .preview/.env.preview weekly-fixtures
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
```

Expect `001_foundation.sql`, `002_scheduling.sql`, `003_weekly_progress.sql`, 15
instruments, and preserved existing synthetic accounts plus four new weekly
accounts and one synthetic sample. `prepare` reapplies no completed migration and
instrument seeding preserves edits. `weekly-fixtures` refuses non-synthetic
accounts and does not overwrite changed roles, approvals, relationships or
passwords. Do **not** rerun the old `fixtures` action.

Passwords for the new synthetic accounts are saved privately beside the config in
`.env.weekly-accounts.json`, ignored by Git. The accounts are
`weekly-preview-member@example.test` (mentee), `weekly-preview-mentor@example.test`,
`weekly-preview-supervisor@example.test`, and `weekly-preview-other@example.test`.
They are synthetic preview-only roles, not production privileges. Existing
`preview-admin@example.test` and its password are preserved.

To choose a test account's password privately in your trusted terminal:

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview reset-password
```

Enter the synthetic account email and hidden password at the prompts. Never send
passwords, session cookies, connection strings or private files in chat. After a
reset, the generated credential file's password for that account is no longer
current; rerunning fixtures deliberately does not overwrite it. Share only the
sanitized `verify` results and whether preparation succeeded.

### Vercel preview configuration

Create only branch-scoped **Preview environment-variable bindings** for
`feature/phase-3a-weekly-progress` on the existing project. Set `DATABASE_URL` to
the isolated preview's pooled connection, and `APP_ORIGIN` to the actual HTTPS
branch alias returned by Vercel. Preserve all Production and Phase 2 Preview
bindings. A Vercel Preview deployment (`target: staging` in the deployment API)
must wait for migration 003 before its database-backed health can pass. Builds
and cold starts never migrate or seed. Vercel preview protection remains enabled;
complete Vercel sign-in, then use the synthetic app account privately.

## Validation and limits

Local API tests use fresh PGlite databases and synthetic records. Browser tests
use an independently initialized temporary database, desktop Chromium and a phone
viewport. The native PostgreSQL CI suite creates/drops a fresh random database on
a loopback PostgreSQL service; it cannot target a cloud host. No automated suite
uses production. Results and live-preview status are recorded in [progress](progress.md).

```sh
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 npm run build
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 npm test
DATABASE_URL= DATABASE_URL_UNPOOLED= VERCEL=0 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Phase 3B/3C issues/announcements/meeting scheduling, uploads, background reminders,
email/push, paid integrations and production release are intentionally deferred.
The original specification remains unchanged in [requirements.md](requirements.md).
