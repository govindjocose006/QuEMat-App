# Visual refresh after the November 2 UI review

The shared teal identity remains. The refresh makes daily work easier to scan:

- Consistent typography, normal-weight input values, compact filters, and smaller summary cards.
- An Account disclosure with keyboard support and guarded sign-out; phone inbox access stays in bottom navigation.
- A quieter overview with a single calendar route in the personal summary and emphasis on assigned issues when present.
- Category-specific instrument symbols and an explicit Operational label, distinct from free booking slots. Missing limits and training guidance remain available in instrument details.
- Calendar date-range headings, today highlighting, and a per-day 24-hour planned-reservation timeline when one instrument is selected. Overnight intervals are clipped to each IST day; text and booking details remain available. Timelines do not imply that gaps are bookable or replace maintenance/training rules.
- Human-readable booking dates alongside native inputs, shorter IST labels, and wider desktop/full-screen phone booking forms.
- Compact sample metadata with handling notes visible, plus contextual empty states for samples, issues, requests, meetings, and notices.
- Report progress, writing prompts, explicit saved/unsaved status, and a shorter Save & review action. Saving, review, submission, unsaved protection, and report privacy are unchanged.

No API permissions, persistence schema, dependencies, notification routing, or production data are changed. Instrument-usage charts remain a later optional monitoring feature; this release adds booking timelines and report progress rather than introducing new analytics.

Validation covers the account menu, overnight timeline geometry, empty-state resets, report progress, accessibility and overflow at desktop and phone widths. Existing end-to-end tests continue to cover notification read state, unsaved reports, role-specific views, bookings, and order recovery. Review images are captured by CI with synthetic data.
