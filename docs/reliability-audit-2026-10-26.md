# Reliability audit fixes - 26 October 2026

Base: production commit b52744791439d62245faac613f0703d731c164f3.
Scope: the five reliability findings from the post-PR10 audit. Tutorial/onboarding changes and Phase 5 are not included.

## Changes

- Weekly editor: dirty reports guard workspace navigation, same-document Back/Forward, review-tab changes, week changes, and explicit sign-out. Cancel preserves editor text; accepting departure discards only unsaved edits. Save success clears the guard; pending saves block internal departure. Browser unload warnings remain. Forced session expiry is not blocked. Draft text is never copied into URLs, history state, or local storage.
- Calendar: request generations invalidate old responses on date-range changes, refresh and unmount. Only data matching the selected range is shown. Loading and failed reads cannot assert that no reservations exist. Existing server booking/conflict protections are unchanged.
- API helper: malformed JSON rejects even with HTTP 200. Unauthorized responses still expire the session if their bodies cannot be parsed. Valid JSON null remains supported for a missing weekly report.
- Orders, Issues, Meetings/Notices: failed reads no longer show empty-state claims; Issues retains a single retry control and suppresses misleading zero counts. Existing refresh/retry controls remain.
- Weekly initial loading: direct retry and error clearing after recovery. A background profile/project update no longer reinitializes and overwrites an open draft; the default project is read when the editor loads.

## Verification

Local build/type checks and four focused API tests passed. New desktop/phone scenarios cover cancelled/accepted dirty navigation, saved draft persistence, weekly loading recovery, out-of-order calendar data, failed list reads, and malformed sample responses. Hosted CI results are recorded on the PR; pending checks must not be treated as passed.

Local browser installation is blocked by a truncated Chromium download. Hosted CI uses an isolated synthetic database, not production. No new migration, dependency, infrastructure, secret, account or production change is required. No live authenticated acceptance is claimed.

## Manual acceptance after a separately authorized release

Use a disposable weekly draft or save any real text first. Check Cancel retains unsaved text on section/week/review/history/sign-out navigation, Save allows departure, and Back/Forward still work. Check a calendar range loads normally and existing order/issue/meeting records remain accessible. Do not rerun any database migration.
