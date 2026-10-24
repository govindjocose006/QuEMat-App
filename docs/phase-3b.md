# Phase 3B: Issues & Requests

This phase is for feature-branch review and the existing isolated synthetic
preview only. Production remains Phase 3A plus the PR #3 sample-list improvement.
Do not merge this phase, migrate production or deploy it to production without
separate authorization. Budget is ₹0; no new infrastructure or paid services.

## Accepted preview; release preparation only

The user confirmed preview issue assignment, acknowledgement, progress and
resolution on 2026-10-24. [Guarded production steps](phase-3b-release.md) are
prepared for a future separately authorized release. They are not an instruction
to run them now. PR #4 stays unmerged; production migration/deployment are not
currently authorized. Preparation is kept local to avoid triggering an automatic
preview deployment. Existing private backups and receipts remain untouched.

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

## Validation and preview status (2026-10-24)

At implementation head `6f88eb4`, branch and PR #4 CI passed build/type checks,
security audit, 123 isolated tests, 18 desktop/phone browser checks and 13 native
PostgreSQL checks. The local delayed-response browser scenarios also pass and
phone/desktop captures were inspected. No automated suite targets production.

The operator verified the Windows preview migration: 001/002/003/004, 15
instruments, 11 synthetic accounts and 6 samples before agent live checks. The
existing Vercel preview is working at
https://quemat-app-git-feature-phase-3b-issues-fa5ba0-govindjocose-2552.vercel.app
with branch-specific preview database/origin bindings. Older bindings remain
unchanged. The initial proxy HTTP 403 cleared after the saved hostname allowance
propagated. Native cloud SQL still fails EAI_AGAIN/getaddrinfo; only the guarded
Windows operator applied 004. No further migration was run by the agent.

Live agent checks through Vercel passed 004-ledger health/all 15 instruments;
member/assignee lifecycle, assignment and unrelated/pending denial; a concurrent
acknowledgement race; comments/links and original acknowledgement/history;
combined search/filter/resolved views; inbox ownership; dashboard scope and
fresh-sign-in persistence. Existing weekly report history remained readable.
PPMS persistence/overlap rejection and furnace-temperature rejection passed.
Manager/academic-role cases passed isolated server/browser checks; private manager
acceptance in the live preview is optional, using the existing synthetic accounts.

Agent-created cleanup: issue **ISS-1 resolved** (history retained), sample **QEM-7
archived**, and booking `af40fc7e-8b64-4e92-8b89-b8631ef81cbc` cancelled. No actual
instrument usage was recorded. No other synthetic records were cleaned up.
Vercel protection remains enabled; temporary automation access was revoked.

### Private preview sign-in and review

Complete Vercel sign-in first, then use the existing app accounts:

- `weekly-preview-member@example.test`: create/edit an issue and discuss their
  own item. For a new issue, assign `Weekly Preview Mentor` if you want to test
  explicit assignee acknowledgement. Requesting attention alone leaves it open.
- `weekly-preview-mentor@example.test`: acknowledge/progress/resolve an assigned
  item; no global issue-management privilege comes from the mentor role.
- `weekly-preview-supervisor@example.test`: inspect the dashboard's directed
  requests, filter the register and comment/change status as an application
  supervisor. Use All/Resolved to find retained issue ISS-1.
- `weekly-preview-other@example.test`: read the shared register; unrelated edit/
  discussion/status actions should be denied unless assigned or reporting.

Passwords remain only in your Windows `.preview/.env.weekly-accounts.json`.
Never send that file, passwords or session cookies. The separately configured
preview administrator can use its existing privately set password; do not reset
it or copy any production credentials. Label new observations/decisions synthetic,
resolve completed checks and preserve their history. There is no sensor, upload,
ordering, payment or background-reminder integration to enable.

All preview branches share the existing synthetic database. Use the Phase 3B
preview to open issue notifications; older preview code does not understand that
new notification source. Historical booking/weekly data remain in the same preview
database. Production is separate and remains on its released 003-compatible code.
