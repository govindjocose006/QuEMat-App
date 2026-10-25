# Phase 3C: Meetings & Notices

**Released on 2026-10-25 (Asia/Kolkata)** through
[PR #6](https://github.com/govindjocose006/QuEMat-App/pull/6).
The operator completed guarded migration 005 and retention verification with no
fixtures. Production health and protected access passed the recorded release
checks. The existing isolated synthetic preview remains separate.

The user confirmed preview meetings, attendee privacy, notes, owned actions,
calendar export, notice reading and fresh confirmation after corrections.
Private authenticated production acceptance is separate from those confirmations.
See [release status](phase-3c-release.md) and [progress](progress.md).
Do not rerun 005 for application-only changes.

## Meetings and permissions

Application supervisors/administrators schedule group or individual meetings,
select attendees, set an agenda, venue/video/data links and Asia/Kolkata times,
reschedule or cancel, and retain notes/history. Academic Supervisor and mentor
labels do not grant management privileges. Group meetings also use explicit
attendee selection; the meeting kind is descriptive, not a privacy switch.

Only current selected attendees and application supervisors/administrators can
read a meeting, its notes/actions/history, dashboard entry or calendar export.
Removing an attendee revokes access to retained material and related inbox links.
Managers intentionally retain access to all meetings. Authorization is repeated
on the server; selecting an academic role cannot elevate permissions.

Notes and event history are retained. Actions have a title, owner, optional due
date and explicit completion/reopening history. Only active authorized owners
and managers can change them; a removed/deactivated owner cannot reopen an action.
Cancelling a meeting does not delete its notes/actions/history.

## Notices and explicit reading

Supervisors/administrators draft, publish, pin, expire or withdraw notices.
Important notices may request explicit reading acknowledgement. Opening a notice,
reading its inbox notification or receiving supervisor attention does not record
that acknowledgement. It is a read confirmation, never purchase/payment approval.

Acknowledgements are idempotent and tied to a specific published revision.
A substantive correction requires a new confirmation; old reading history remains.
Withdrawal does not send a new reading request. Expiry/pinning determine current
dashboard attention without deleting history.

## Integration and calendar export

Upcoming meetings and pinned notices appear on the dashboard. Relevant members
receive persistent in-app notifications. Removed meeting access and notice scope
are respected by inbox retrieval; marking an inbox entry read remains separate
from explicitly confirming a notice revision.

Calendar export is a private static download showing the Asia/Kolkata meeting
time. Downloading it grants no ongoing access and does not subscribe an external
calendar to later changes. After rescheduling/cancellation, export the new version.
Data links do not fetch or grant access to their destination.

No attachments, sensors, automatic ordering/payments, background scheduler,
email/push service or new role/delegation system is introduced. No paid resources
or new infrastructure are required.

## Isolated review

Use the existing synthetic preview accounts and their privately stored passwords.
Do not reset passwords, copy production configuration or run fixtures/migrations
just to review application-only changes. Preserve earlier preview records.

Review a labelled meeting with a selected attendee, notes, owned action, schedule
change and calendar export. Confirm an unrelated member cannot see it. Review a
notice with explicit reading and a correction requiring new confirmation. Clean
up only the review meeting/notice through cancellation or withdrawal and retain
their history; do not record physical instrument usage for a UI check.

Detailed historical preview preparation and validation notes remain in Git
history and PR #6. Current validation for later audit fixes is tracked in their
own PR. Phase 4 has not started.
