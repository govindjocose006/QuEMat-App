# Live UI review refinements

These changes address the desktop review of the production administrator workspace on 1 November 2026.

- Notifications use compact rows, explicit read/unread text, aligned controls and readable booking cancellation copy. Viewing an item still does not mark it read or acknowledge it.
- Booking start/end inputs are adjacent, with an IST-based reserved-duration summary. Quantity and unit stay together in chemical requests.
- Active instrument cards open a filtered schedule. New bookings inherit the selected instrument; operating eligibility remains enforced by the existing server rules.
- Issue escalation guidance explains routine assignment, supervisor intervention and in-app recipients without changing routing or permissions.
- Weekly reports use a compact status area and keyboard-focus shortcuts to the three writing sections. Draft, review, submission and privacy behavior are unchanged.
- Samples default to compact rows, with a Cards option. Storage and handling notes remain visible in both modes.
- Calendar date navigation is separate from a keyboard-accessible Manage availability disclosure, shown only to existing operational managers.

No dependencies, services, database migrations or permission changes. Global search, recently used instruments and a separate supervisor review queue remain later suggestions, outside this implementation.

Validation: production build and TypeScript checks pass locally. Focused browser coverage includes instrument-to-booking preselection, duration, report focus/unsaved content, notification read state, sample-layout switching, accessibility and overflow. Existing browser workflows remain part of CI. Final CI and screenshot review results are recorded in the pull request.
