# New-member guidance

This change builds on production commit `97ca52e2c34e8a24a3ccdbfd7c558d308c63aee5`. It adds guidance to existing workflows, without a new service, database migration or permission change.

## Joining

Registration and profile screens show three stages: Create account, Your details, Approval. The waiting screen explains who reviews the request and how to check status. Pending or inactive accounts cannot reach the workspace guide through a bookmark.

## Getting started

Overview shows an optional Start here card. Its three suggestions use **application permissions**, never an academic title alone:

- Member: register a sample, plan a measurement, write weekly progress.
- Mentor: update/review progress, plan a measurement, report or follow up on an issue.
- Supervisor: review progress, follow up on issues, arrange meetings/notices.
- Administrator: review membership, plan a measurement, arrange meetings/notices.

Quick Guide remains in desktop navigation and the phone's More menu. It supports the existing safe `#guide` bookmark and Back/Forward navigation. Opening it respects unsaved weekly-report warnings.

Expandable topics cover samples/bookings/actual usage, weekly drafts and revisions, issue acknowledgement, meetings/notices/inbox, chemical requests and archived samples/account details. Shortcuts open existing sections; they never create records or submit forms. Interns and master's students get mentor-assignment guidance. Administrator-only membership instructions follow application permissions.

## Preference and privacy

Hide welcome tips is optional. The versioned local-storage key `quemat-welcome:v1:<account UUID>` stores only the value `hidden`. No names, emails, drafts or lab records are stored. It affects only that account in that browser; clearing browser data shows tips again. Quick Guide can restore them. If storage is blocked, hiding/restoring still works for the current workspace session. The workspace remounts for a different authenticated account.

## Verification and release

Browser coverage includes desktop/phone layouts and automated accessibility, keyboard topic expansion, task destinations, bookmarks, permission-specific suggestions, approval gating, preference persistence and account isolation, blocked storage, and unsaved-report protection. Existing registration/approval checks now cover the three stages. Synthetic screenshots are retained by CI. Check the PR for actual results; do not treat pending checks as passed.

No production data or credentials are needed for these checks. No paid resources or additional infrastructure. Phase 5 remains separate. This PR needs review before release; no Windows database commands are required.
