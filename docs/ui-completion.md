# UI implementation coverage

Checked on 31 October 2026. This document records the concrete UI scope in PR #17,
not a claim that every possible improvement or future product feature is complete.
The earlier conversation's full suggestion list could not be retrieved during this
check. Coverage is based on the retained UI stages, the workspace refresh plan,
and inspection of the current daily workflows.

## Release distinction

- PR #13: released workspace navigation, compact monitoring and onboarding layout;
  see `workspace-refresh.md` for that stage.
- PR #16: released multilingual save and meeting/notice recovery fixes, not the
  new daily-priority overview or form redesign.
- PR #17: overview, forms and register/detail improvements listed below. Review
  the PR's current status and release receipt before assuming it is deployed.

## Implemented scope in PR #17

| Area                       | Result                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused overview           | Three role-aware starting points; supervisor sees escalations, pending reports and lab status. Full lab activity and coordination expand on demand.                                                                |
| Visual hierarchy           | One prominent page action, restrained status styling, consistent spacing, compact record lists and clearer section headings.                                                                                       |
| Booking                    | Grouped reservation/sample/setup fields, searchable samples retaining selection, optional project/participants, option-load retry and reachable save action.                                                       |
| Weekly report              | Three writing sections, progress/private-draft state, optional links and supporting records, reachable save/review controls, explicit submission.                                                                  |
| Issues                     | Search, work view and assignee remain visible; secondary filters expand with active count. Filter chips, result count and clear action remain visible. Old responses cannot replace newer filters.                 |
| Issue form/detail          | Grouped description and responsibility fields; related records and links optional. Escalation remains visible; discussion and current actions remain visible; retained history expands with an event count.        |
| Chemical requests          | Required name/quantity/unit/purpose first; optional specifications and purchasing details expand. Compact lists, filter summary/clear, explicit retry, selected form/detail focus and expandable retained history. |
| Samples                    | Compact register with search/status reset and result count. Storage and handling notes stay visible. Other metadata expands. Grouped identity and preparation/handling form.                                       |
| Meetings/notices           | Side-by-side lists on wide screens, stacked on phones. Grouped meeting and notice forms, attendee search retaining selected people, selection count, optional data links and reachable save actions.               |
| Phone and keyboard use     | Single-column fields, wrapping lists/filter chips, 44px controls, native keyboard disclosures, invalid collapsed fields revealed before focus, existing More menu and unsaved-draft guards.                        |
| Loading/error/empty states | Explicit result state, retry and clear-filter controls; stale issue/order/sample cards hidden while loading or after a failed fetch. Existing meeting/notice recovery retained.                                    |

No backend, schema, dependency, permission, notification, account-role or production
configuration changes. Weekly-report privacy and the supervisor's quiet escalation
workflow remain unchanged. No stock graphics, paid packages or extra services.
Instrument setup, member administration, audit history, inbox and calendar retain
the existing workspace shell and working permission boundaries; they do not need
a replacement workflow for this UI scope.

## Validation

The PR records exact build/test results and screenshot artifact links for its
current commit. Browser tests exercise desktop and phone layouts with synthetic
records in a temporary test database. Added regressions cover filter retention and
out-of-order responses, sample handling visibility and edit preservation, attendee
search, Enter in search, invalid collapsed links, optional order/issue values,
accessibility and horizontal overflow. No production test data is created.

Remaining product phases in `progress.md` are separate feature work, not unfinished
parts of this UI implementation.
