# Phase 3B: Issues & Requests

This phase is for feature-branch review and the existing isolated synthetic
preview only. Production remains Phase 3A plus the PR #3 sample-list improvement.
Do not merge this phase, migrate production or deploy it to production without
separate authorization. Budget is ₹0; no new infrastructure or paid services.

## Working workflows

Approved, onboarded members can read the shared register and create an item with
a title, description, category, priority, optional due date, related instrument,
sample and project, assignee, supervisor-attention request and HTTP(S) data links.
The server supplies the reporter, permanent `ISS-` code and timestamps. Projects
remain free text, matching existing samples/bookings; there is no new project
registry. New links/assignments must target active records/approved members;
existing archived relations and inactive assignments remain visible in history.

Categories: helium refill, instrument malfunction, consumables/maintenance,
proposal-writing needs, purchase approval, measurement assistance and general
decisions. Helium entries are **manual observations**, never sensor readings.
Purchase approval entries record a requested decision and discussion only; write
the actual decision in a comment/status reason. No order, payment or separate
procurement workflow is triggered by acknowledging or resolving an issue.

| Actor                                                  | Read                                             | Edit details / assignment | Comment                        | Acknowledge / advance / resolve | Reopen                         |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------- | ------------------------------ | ------------------------------- | ------------------------------ |
| Active approved member                                 | Shared register                                  | Own reported items        | Own reported or assigned items | Assigned items                  | Own reported or assigned items |
| Application supervisor / administrator                 | Shared register                                  | All                       | All                            | All                             | All                            |
| Mentor / academic Supervisor                           | Same rules as other members unless a participant | No extra privileges       | No extra privileges            | No extra privileges             | No extra privileges            |
| Pending, inactive or incomplete membership / anonymous | Denied                                           | Denied                    | Denied                         | Denied                          | Denied                         |

All authorization is enforced on the server. Writes recheck the actor inside the
transaction. Academic role selection cannot grant application privileges.
Reporters may assign any active approved member; assignment does not imply that
the assignee has accepted or acknowledged the work. This shared operational
register is not a confidential personnel/medical reporting channel.

Status transitions:

- Open → acknowledged (explicit assignee/manager action).
- Acknowledged → in progress, blocked or resolved.
- In progress → blocked or resolved.
- Blocked → in progress or resolved.
- Resolved → open (reporter, assignee or manager), then explicitly acknowledge again.

Every status change requires a reason and expected version. Concurrent/stale
changes return 409 without duplicate events/notifications. A supervisor-attention
checkbox alone leaves the item open/unacknowledged. First acknowledgement and
most recent resolution names/times are retained after reopening; every later
acknowledgement/resolution actor remains in chronological status history.

Details/assignment edits retain full before/after snapshots. Comments and status/
edit events are append-only, protected by database triggers. Items cannot be
deleted through the API; resolution separates finished work from daily attention.
Data links are not fetched by the server and never grant access at their target;
share linked material only with intended readers. Private attachments are deferred.

## Finding work and following up

The register defaults to **Open work (unresolved)**. Resolved and All views retain
history. Search matches ID/title/description/project/person/instrument/sample ID;
filters cover status, priority, category, instrument and assignee, including
assigned-to-me and unassigned. Lists use 50-item pages. Search wildcard characters
are literal, not a way to bypass filters.

The dashboard shows urgent unresolved work and the signed-in member's assignments.
Application supervisors/administrators also see supervisor-directed requests.
Each group shows its total and the five most recently updated items; open the
register for the complete filtered list. There are no rankings or booking-hour
scores. Due dates are date-only Asia/Kolkata dates; event timestamps are stored
in UTC and displayed in Asia/Kolkata.

The existing persistent inbox links to each issue. Creation, reassignment/detail
changes, status changes and discussion notify relevant active reporters/assignees
and application managers when supervisor attention is/was requested; former
assignees are notified of reassignment. The actor is not notified of their own
action. Transactional event keys prevent duplicates. Attention wording explicitly
distinguishes the request from acknowledgement. Inbox/dashboard polling occurs
while open; no background scheduler, email, push or reminder delivery is enabled.

## Additive migration and isolated validation

`004_issues_requests.sql` adds issues, history, comments, their sequence/indexes
and retained-history triggers. It adds nullable `notifications.issue_id` and
extends the existing exactly-one-source check to booking **or** weekly report
**or** issue. Existing booking/weekly inserts and records remain compatible.
Migrations never run automatically during Vercel builds or cold starts. The new
feature health check requires 004. Older production health still requires 003.
The Phase 3A production release tooling remains pinned to reviewed 003 and must
not be reused to authorize 004.

```sh
npm run build
npm run typecheck:release
npm test
npm run test:e2e
```

All automated tests use synthetic temporary PGlite databases. Native PostgreSQL
CI creates/drops only a fresh random loopback database, preserves populated
Phase 2/3A records through 004, and checks concurrent issue acknowledgements and
source/history safeguards alongside booking regressions. Browser checks cover
creation, links, comments, lifecycle, filters, notification navigation, academic
role denial and supervisor decisions on desktop and phone, with accessibility
and horizontal-overflow checks. Never select production for a test command.

## Existing isolated preview and Windows fallback

Reuse project `sparkling-meadow-75486459`, database `quemat_pr1_preview`, direct
host `ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech` and the existing Vercel
`quemat-app` project. Do not create a Neon branch/database/project. Preview uses
synthetic records only; do not copy production data/credentials. The existing
private `.preview/.env.preview` explicitly selects this target and stored marker.
The prepare action now also refuses non-synthetic accounts before migration.
Do not use ordinary `.env`-loading `db:*` commands, production config or fixtures.

In the separate trusted Windows **preview checkout**, run each step separately,
stopping on error:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch --track origin/feature/phase-3b-issues-requests
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed. See existing-branch note.' }
```

If the local feature branch already exists, use `git switch
feature/phase-3b-issues-requests` followed by `git pull --ff-only`, checking each
exit code instead of `git switch --track`.

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
```

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview verification failed.' }
```

Confirm the exact preview host/database above before proceeding. Never paste
connection URLs, passwords, private files or logs into chat.

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview prepare
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview migration failed.' }
```

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview verification failed.' }
```

The final sanitized result must include migrations 001/002/003/004 and 15
instruments. Existing synthetic accounts/samples/history remain; do not rerun
initial fixtures, weekly fixtures, password resets or account creation. Use the
existing synthetic preview member, assignee and supervisor accounts. Their
passwords remain in the private files on the trusted Windows computer.

Vercel Preview variables must be scoped to `feature/phase-3b-issues-requests`,
using the existing preview database and the actual branch alias as `APP_ORIGIN`.
Preserve all Production and older preview bindings. Complete Vercel protection
sign-in yourself, then app sign-in privately. This phase is not a production
release. Final preview URL, live checks and remaining blockers are recorded in
[progress.md](progress.md).
