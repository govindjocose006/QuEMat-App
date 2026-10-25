# Monitoring audit fixes — 2026-10-25

These application/API/UI changes address the six supplied monitoring findings.
They require **no database migration, fixtures, password resets, additional cloud
resources or paid services**. Phase 4 remains out of scope. Production release
uses the existing application review/deployment process; do not rerun 005.

Released through PR #7 on 2026-10-25 after user-confirmed preview acceptance.
The reviewed head includes compatibility with Vercel routing query metadata.
Final deployment/CI evidence is recorded in PR #7; private production acceptance
is separate from preview acceptance.

## Instrument freshness and handover

`GET /api/monitoring` requires approved membership. A read-only repeatable-read
transaction returns the current active instrument register, current/next booking
window, cleanup/active runs and the most recent completed/interrupted actual run
per instrument. Last handovers are independent of the booking-window cutoff.

The visible dashboard polls the complete snapshot every 30 seconds, on browser
focus/visibility return, or with Refresh monitoring. The same instrument list
updates overview totals. Failed refreshes retain the last successful snapshot,
its timestamp and an error; no successful refresh is claimed for a failed call.
Calendar/register instrument status also refreshes while those pages are open.

Cards show instrument operational status separately from scheduled/actual usage,
sample IDs and compounds alongside running/scheduled/next measurements, and the
last handover's operator/time/notes. Furnace unloading confirmation remains explicit.
No automatic instrument sensing/control or change to booking/unloading rules is added.

## Complete, scoped notification retrieval

- `/api/notifications/page` returns up to 50 items by default (maximum 100),
  `nextCursor` and the accessible unread count. `before` is the previous page's
  opaque last notification ID; `unread=true` selects unread updates.
- Ordering uses stored `(created_at,id)` values descending, retaining timestamp
  precision and stable ties without offset drift when new updates arrive.
- `/api/notifications/summary` returns the same visibility-scoped unread count.
- Pages, counts and read actions enforce recipient ownership and current private
  meeting/notice access. Losing attendee access hides the old notification from
  both the page and count. Reading an inbox item never acknowledges a notice.
- `/api/notifications` retains its original bounded array response for existing
  clients; the current inbox uses `/page` and Newer/Older navigation so records
  beyond the previous 200-item cutoff are reachable.

The persistent Inbox button and navigation badge show outstanding updates. Counts
refresh every 30 seconds while visible, on focus, and after marking an item read.
During a transient count failure the last confirmed count is retained; its
accessible description says it is the count at the last check. No email, push or
background delivery service has been added.

## Phones and recovery

Phone navigation keeps Overview, Calendar, Notifications and More visible without
a horizontal destination strip. More reveals the other approved destinations in
a wrapping panel. Selecting one closes the panel and moves focus into the main
content; Inbox remains accessible in the header. Desktop navigation is unchanged.

Successful inbox, sample, weekly-detail and meeting-summary refreshes remove stale
errors. Samples have an explicit retry action. Request generations prevent older
inbox/instrument responses from overriding newer successful reads.

## Validation and review

Tests use isolated synthetic databases only. API regressions cover >200 unread
notifications, exact timestamp ties/microseconds, new arrivals during paging,
read filtering/ownership, malformed page inputs, private-access revocation, old
handover retention and fresh instrument status. Native PostgreSQL CI exercises
the new snapshot and pagination queries alongside the existing release safeguards.

Desktop/phone browser coverage checks polling after a status change, handover and
sample IDs, reaching the 205th inbox item, unread counts, retry recovery, More
navigation, automated WCAG checks and horizontal overflow. CI saves selected
synthetic-data screenshots in its monitoring-review artifact. Actual results and
remaining limitations belong in the pull request, rather than being assumed here.

For private preview acceptance, use the existing synthetic preview accounts/data
and preserve all earlier fixtures. Confirm the main dashboard and inbox on desktop
and phone, open More, and check the latest handover. Do not create hundreds of
production notifications or record physical instrument usage as a test.
