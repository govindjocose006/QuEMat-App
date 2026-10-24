# Phase 3C: Meetings & Notices

Feature branch: `feature/phase-3c-meetings-notices`. This phase is for the existing
isolated synthetic preview only. **Do not merge, apply 005 to production or deploy
this phase to production.** PR #5's separate production release needs no migration.
Budget stays ₹0: existing Vercel/Neon resources and free local tools only.

## Workflows and permissions

Application supervisors and administrators schedule group/individual meetings,
select attendees, set agenda, venue, video/data links and Asia/Kolkata start/end
times, reschedule and cancel. Neither an academic Supervisor label nor mentor
assignment grants management permission. No new delegation/role system is added.
Group meetings also use explicit attendee selection rather than automatically
including everyone. The meeting kind is a descriptive label, not a privacy toggle.

Only current selected attendees and application supervisors/administrators can
read a meeting, notes, action items, history, dashboard entries or calendar export.
Removing an attendee immediately removes that access, including old notes and
notification links. Managers intentionally have access to all meetings. A newly
selected attendee can read that meeting's retained history; take that into account
before expanding an individual meeting's audience. Historical authors and inactive
attendees remain named without granting inactive accounts access.

Managers edit schedules and attendee lists. Participants/managers append notes
with data links; corrections are new notes, not destructive edits. Managers assign
action items to active selected attendees, with optional due dates. Only the
owner or a manager can complete/reopen an action; actor/time/status history is
retained. Complete an owner's open actions before removing them as an attendee.
Cancelled meetings retain notes/history and existing action completion; new actions
and rescheduling are disabled. Schedule a new meeting if cancellation is reversed.
Meetings do not reserve instruments, infer attendance or record actual lab usage.

Notices start as manager-only drafts. Publishing is explicit. Managers can edit,
pin/unpin, expire, withdraw and republish. Published notices are visible to all
active approved onboarded members. Expired published notices move out of the
current/pinned views into Expired; their history remains readable. Withdrawn
notices and unpublished drafts are manager-only. Member revision histories never
include unpublished draft snapshots. The first publication timestamp is retained.

An optional acknowledgement means **the member explicitly confirmed reading that
revision**, not approval, agreement or a completed action. Opening a notice or
marking an inbox message read does not acknowledge it. Confirmation requires its
own checkbox and submit, is idempotent for member+revision, and records a timestamp.
Every saved published revision (including pin/expiry edits) requires a fresh read
confirmation when requested; old receipts remain. Members see their own receipts;
managers see all. Expired/withdrawn notices cannot collect new acknowledgements.

## History, notifications and export

Additive `005_meetings_notices.sql` adds meetings, current attendee mappings,
append-only meeting events/notes/action events, action state, notices, append-only
notice events/read receipts, indexes and two nullable notification source columns.
The source constraint still requires exactly one booking/weekly/issue/meeting/notice
source. No existing rows or earlier migration files are rewritten. There are no
uploads, seeds, account changes or data backfills in 005. Builds/cold starts never
run migrations; the new health check requires the 005 ledger through the runtime
PostgreSQL connection. Earlier clients remain compatible with the additive schema.

Writes use the existing database transaction/write lock, re-read active permission
and membership, validate references and reject stale versions with 409. Immutable
history and record identity are also protected by database triggers. Changes and
notifications commit together. Private meeting content stays in scoped meeting
history; the general administrator audit stores event identity/version only.

The existing persistent inbox receives scheduling/changes/cancellation, notes,
actions, publishing/edits and explicit read events. Own actions are excluded,
recipient/event keys prevent duplicates, and removed attendees/unpublished notices
are filtered from member inbox reads. Notification text contains no private meeting
title, agenda or note body. It is an in-app update, **not delivered email/push or a
background reminder**. Expiry is evaluated on reads; no scheduled process is needed.

Calendar export is an authenticated `.ics` download for one authorized meeting.
It uses `TZID=Asia/Kolkata`, a fixed +05:30 timezone definition, UTC audit stamps,
stable UID, increasing SEQUENCE and cancellation status. Text is escaped and folded
at 75 UTF-8 octets, without splitting code points. Exports include agenda/location/
video link but no meeting notes, action discussion or attendee emails. The private
download is a snapshot, not a live subscription or invitation. Re-export after
changes/cancellation; calendar clients vary in how they import updates. Previously
downloaded copies cannot be remotely revoked. Keep them private.

## Existing isolated preview and Windows fallback

Use only the **separate preview checkout**, for example
`C:\Users\Govind Unnikrishnan\QuEMat-PR1-Preview`, and the already-created private
`.preview/.env.preview`. Do not copy the production `.env` or release configuration.
The preview CLI does not load `.env`, `.env.local`, ambient DATABASE_URL or PGPORT.
It rejects production endpoints/database, verifies the explicit config and stored
preview identity, and refuses migration/fixtures if any account is non-synthetic.
The two new Vercel variables must be Preview-only, scoped to this feature branch;
never edit Production or earlier preview bindings.

The existing target is project `sparkling-meadow-75486459`, branch
`br-patient-shape-a1fnddux`, database `quemat_pr1_preview`, direct hostname
`ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech`. Reuse the existing pooled runtime
connection. Do not create another cloud resource. Cloud read-only verification
currently fails DNS `EAI_AGAIN` at that hostname, including outside the sandbox;
this is distinct from local synthetic PostgreSQL/PGlite and Vercel runtime checks.

Run small PowerShell steps **one at a time, stopping on any error**. First run
`git status --short` and stop if there are uncommitted changes. From the separate
preview checkout:

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch --track origin/feature/phase-3c-meetings-notices
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
git rev-parse HEAD
```

If that local branch already exists, use `git switch feature/phase-3c-meetings-notices`
then `git pull --ff-only`, checking each exit code. Confirm the displayed commit
matches the published reviewed head given in chat before proceeding.

```powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependency installation failed.' }
```

Read-only target check (prints sanitized metadata only):

```powershell
$phase3cPreviewCheck = node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview verification failed.' }
$phase3cPreviewCheck
$phase3cPreviewTarget = $phase3cPreviewCheck | ConvertFrom-Json -ErrorAction Stop
if ($phase3cPreviewTarget.host -ne 'ep-old-haze-a1w10w9n.ap-southeast-1.aws.neon.tech' -or $phase3cPreviewTarget.database -ne 'quemat_pr1_preview') {
    throw 'Stop: unexpected preview target.'
}
```

Only after the target check passes, apply the pending migration and repeatable
15-instrument seed **to preview only**:

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview prepare
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview migration failed. Do not retry blindly.' }
```

Optional repeatable synthetic meeting/notice (uses existing weekly preview roles;
never creates/resets accounts/passwords or runs initial account fixtures):

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview meetings-fixtures
if ($LASTEXITCODE -ne 0) { throw 'Stop: meeting fixture preparation failed.' }
```

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: final preview verification failed.' }
```

Final output must list 001–005 and 15 instruments at the exact preview host/database.
Share only the sanitized JSON/result; never credentials, private configs/account
files, archives, receipts or logs. Leave production migration/merge/deployment alone.

## Private preview acceptance

Complete Vercel sign-in if prompted, then use existing synthetic weekly accounts.
Passwords remain only in the operator's Windows `.preview/.env.weekly-accounts.json`.
Do not share that file or any password/session cookie.

1. As `weekly-preview-supervisor@example.test`, schedule a labelled group or
   individual meeting for `weekly-preview-member@example.test`, add an agenda/link,
   reschedule it, add notes and assign a dated action to that attendee.
2. As the selected member, refresh to confirm persistence, see history, add a note,
   complete/reopen the owned action and export the IST calendar. As
   `weekly-preview-other@example.test`, confirm the private meeting is absent and
   direct detail/export access is denied.
3. As supervisor, draft/publish/pin a synthetic notice requesting acknowledgement.
   As member, verify opening/inbox-read does not acknowledge it; explicitly confirm
   reading, refresh, then check a supervisor correction needs a fresh confirmation.
4. Cancel only the test meeting and withdraw/unpin or expire only the test notice;
   retain history. Confirm dashboard separation and existing bookings/weekly/issues
   still work, including issue status changes without reasons. No physical usage.

## Validation status

The operator applied 005 and `meetings-fixtures` successfully from the separate
Windows preview checkout. Sanitized verification lists 001–005 at the expected
preview host/database with **15 instruments, 11 synthetic accounts and 7 samples**.
No passwords/accounts were reset. This is operator-confirmed native Windows SQL,
not cloud-native connectivity. Vercel Preview variables DATABASE_URL/APP_ORIGIN
are scoped only to this branch; all eight earlier bindings remain unchanged.

Preview URL:
https://quemat-app-git-feature-phase-3c-meetin-2d790f-govindjocose-2552.vercel.app .
Configured preview deployment `dpl_G6EKThccYsEC3LLDQZHdXNN7bf6W` is READY at
implementation/test head `c480747`. Live verification is blocked, not claimed. Cloud proxy reachability currently fails with **tunnel HTTP 403** at that
hostname, also outside the sandbox; its network-domain allowance was requested.
This is separate from the native PostgreSQL DNS failure above and from Vercel's
normal authenticated preview protection.

At implementation/test head `c480747a4dbfbc9a47860700bf1c6fe82748ea49`, both
branch and PR CI passed: **153 isolated tests in 14 files**, **19 native PostgreSQL
checks**, **24 desktop/phone browser checks**, build/application/release type
checks, Windows setup-script syntax parsing and security audit (zero known
vulnerabilities). [PR CI](https://github.com/govindjocose006/QuEMat-App/actions/runs/40120269727).
Native tests include populated pre-005 preservation and independent concurrent
meeting cancellation/read acknowledgements. Browser coverage includes scoped
meetings/notes/actions, rescheduling/cancellation, private IST exports, notice
publishing/read-revision history/withdrawal, academic-role denial, automated WCAG
and overflow checks, plus prior booking/furnace/weekly/issue/account workflows.
The first browser run's filled-text selector was corrected; all 24 pass without
relaxing permissions or changing production code to accommodate a test.

Local final build/release checks and audit also pass. Screenshots were inspected
for desktop/phone readability. Earlier overlapping local workloads caused two
integration-test timeouts; sequential affected suites passed all 27 and hosted
full suites passed. All automated tests use temporary synthetic databases, never
production. Authenticated live manager/member acceptance remains pending the
operator's private checks and the preview-host allowance. No preview protection
was disabled and no automation bypass key has been created.
