# Workspace navigation and sample-loading improvements

Small follow-up to the released Phase 4 app; this does not start Phase 5.

## Behaviour

- The active section has a bookmarkable fragment such as `#samples` or `#orders`.
  Refresh returns to that section; browser Back/Forward follows section changes.
  The tab title identifies the section. It contains no record names or IDs.
- Section navigation still requires approved sign-in. Unknown section fragments
  fall back to Overview, and non-administrators cannot select administrative
  sections. API authorization remains unchanged and authoritative.
- Skip to content still moves focus without switching sections. Mobile More
  closes after a section change. No local-storage copy of lab records is added.
- Samples shows a loading message while fetching. A failure displays its error
  and Retry samples, never a misleading empty-register message. Successful retry
  clears the error; an empty message appears only after a successful empty read.

This restores the section only: unsaved forms, filters and selected records are
not persisted across a browser refresh. No autosave or offline support is implied.
Notification links still open their record in the current session, without putting
that record's identity into the URL.

## Verification and release boundary

Regression tests cover section history/reload, bookmarked sign-in, restricted
sections, unknown fragments, skip-link behaviour, sign-out privacy, slow sample
loading and failed-request recovery on both desktop and phone. Existing app tests
continue to cover the underlying API/data workflows. Results are recorded in the
associated PR; do not infer success merely from the existence of tests.

No schema, production configuration, release guard, account or dependency change
is required. Production remains at the separately released Phase 4 commit until
this follow-up is reviewed and released. No production migrations or fixtures
should run for this update.
