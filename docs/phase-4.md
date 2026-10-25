# Phase 4 — chemicals and order tracking

Implemented on `feature/phase-4-chemical-orders` for isolated preview review.
Production remains on the accepted monitoring-audit release. This phase needs the
additive `006_chemical_orders.sql` migration; builds do not run it automatically.
No production migration or release is authorized by this guide.

## Workflow

Any approved, onboarded member can request a chemical. All approved members can
view shared requests and costs. Requester, supervisor and administrator can manage
an item; another member cannot alter it. Selecting an academic title does not
confer supervisor permissions. No automatic approval or purchasing process is added.

Requests have stable ORD IDs, chemical name, CAS, purity/grade, catalogue number,
quantity/unit, purpose/project, preferred supplier, estimated INR cost and notes.
Requests can be edited before ordering. Recording an order stores supplier,
ordered-by member, order date, expected delivery, optional cost and invoice/order
reference. It does not place a supplier order or make a payment. Ordinary members
record themselves as ordering; a manager may record another approved member.

Order metadata can be corrected with a new retained revision, including entering
an invoice cost later. A correction preserves the status, quantities and earlier
history. An existing ordered-by identity can remain even if that member later
becomes inactive. Request quantities/units are frozen after ordering.

Deliveries support partial receipt and preserve receiver, date, quantity and notes.
The remaining quantity cannot be exceeded. Requested/ordered dates and receipt
chronology use calendar dates in Asia/Kolkata; future actual dates are rejected.
Cancelling closes the unfulfilled remainder in the tracker, preserves deliveries
and does not cancel a supplier order or arrange a refund. Completed/cancelled
records appear under the closed view and are never deleted.

Costs are exact integer paise (INR) with a two-decimal input limit; blank and zero
are distinct. Quantities allow up to three decimal places. The UI is for tracking
requested and received amounts, not a chemical stock ledger or consumption system.

## Monitoring and permissions

The dashboard shows requested, awaiting delivery and past-expected-date counts.
It refreshes while visible every 30 seconds and on focus, and offers retry after
failure. The order list has shared/open/closed/mine views, search, status filters,
50-record pages and manual refresh. Old fetch results cannot overwrite newer reads.

The requester, recorded ordering member and active managers receive persistent
in-app notifications. Reading one does not approve a purchase. The inbox opens
the linked record. No email, push, scheduled reminders, uploads or paid service
is added. Existing authentication, approval, CSRF and private meeting rules remain.

Mutations run in the existing database write transaction with optimistic versions.
Concurrent stale actions fail with 409 rather than double counting a delivery.
Order events and deliveries are append only; identities are protected; constraints
bound received quantity and notification sources. Cancellation/metadata corrections
retain original actors, before/after values and audit records. Migration 006 adds
new tables/sequence/indexes and a nullable notification link; it rewrites no old rows.

## Existing Windows preview only

Use the **separate preview checkout**, preserving its existing private preview
config and password files. Do not use the production checkout or any `db:*` npm
command. Stop after any failed command. First ensure the checkout is clean:

```powershell
git status --short
```

If it prints changes, preserve them and stop. Otherwise run each block separately:

```powershell
git remote set-branches --add origin feature/phase-4-chemical-orders
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Stop: fetch failed.' }
git switch --track origin/feature/phase-4-chemical-orders
if ($LASTEXITCODE -ne 0) { throw 'Stop: branch selection failed.' }
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Stop: dependencies failed.' }
```

If already tracking this branch, switch to it and `git pull --ff-only` instead.

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: preview verification failed.' }
```

Confirm the database is the existing isolated `quemat_pr1_preview` and the host
matches your previously verified preview host. The script also validates its
explicit configuration and stored marker. Only then:

```powershell
node --import tsx scripts/preview-db.ts .preview/.env.preview prepare
if ($LASTEXITCODE -ne 0) { throw 'Stop: migration failed. Do not retry blindly.' }
node --import tsx scripts/preview-db.ts .preview/.env.preview verify
if ($LASTEXITCODE -ne 0) { throw 'Stop: final verification failed.' }
```

The final result must list migrations 001–006 and retain 15 instruments. Share
only sanitized verify JSON. Do not run fixtures/reset passwords or share private
configs, credentials or account files. No new database/project is needed.

## Private preview acceptance

Use existing synthetic preview accounts after the preview's branch bindings and
health are confirmed. Never test this feature with real orders in production.

1. Create a labelled synthetic request; save/reload, edit and confirm history.
2. Record a synthetic already-placed order, ordered by yourself, with INR cost.
3. Receive part of the quantity, reload, then receive the remainder. Confirm both
   delivery rows, status and exact cost. Reject quantities above the remainder.
4. Correct the recorded cost/reference; confirm earlier history remains.
5. Find received/cancelled records under the closed view and open a notification.
6. As a different member, confirm read access and no mutation controls. Test manager
   handling and sign out. Check phone More navigation, forms and horizontal overflow.

API/native tests cover quantities/costs/dates, cross-member restrictions, stale
concurrent actions, cancellation, immutability, notifications, pagination and
migration preservation. Desktop/phone tests exercise the form workflow and
accessibility. Actual CI and live outcomes are recorded in the Phase 4 PR;
implementation does not imply live readiness or production release.

The separately guarded [production release guide](phase-4-release.md) and
migration-006 backup/preservation tooling are prepared for review. Previous migration-specific release scripts
must not be reused or widened to authorize 006. Keep all backups/receipts untouched.
