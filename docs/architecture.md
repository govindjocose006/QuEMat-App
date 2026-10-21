# Architecture and security

## Stack and deployment

Phase 1 uses Node 24, TypeScript, React 19, Vite 8, Express 5, Zod 4, and PostgreSQL.
Vercel serves `dist/client` and the Node function `api/index.ts`; Neon hosts the
persistent relational database. `package-lock.json` pins installed dependencies.

The `pg` adapter uses a maximum of three connections per function instance,
short idle timeouts, verified TLS, and Vercel's `attachDatabasePool` integration.
Data, sessions, and authentication throttles are stored in PostgreSQL. Vercel
cold starts do not create schemas, seed records, or bootstrap administrators.

Without `DATABASE_URL`, local development uses PGlite's PostgreSQL engine and the
same migrations. This is a persistent **single-process development database**;
it is not a shared hosted backend. Production and Vercel explicitly reject local
fallback. Hosted Neon transport and Vercel deployment require separate live checks.

Prepared SQL and numbered migrations define members, sessions, instruments,
training entries, SOP links, audit events, and rate limits. Stable UUIDs identify
members/instruments. Timestamps are UTC ISO strings or UTC epoch expiry values.
Display uses Asia/Kolkata; default currency is INR.

## Official documentation used

- [React quick start](https://react.dev/learn) and [Vite guide](https://vite.dev/guide/),
  read through their official GitHub documentation repositories.
- Express 5, Helmet, and express-rate-limit installed official READMEs.
- [Node crypto](https://nodejs.org/api/crypto.html): scrypt and secure randomness.
- [node-postgres TLS documentation](https://github.com/brianc/node-postgres/blob/master/docs/pages/features/ssl.mdx):
  connection-string SSL options can replace explicit settings. The adapter removes
  those options and requires certificate verification instead.
- [PGlite API](https://github.com/electric-sql/pglite/blob/main/docs/docs/api.md):
  creation, transactions, persistence, and development exports.
- Installed [Vercel Functions SDK](https://www.npmjs.com/package/@vercel/functions)
  documentation/types: pool lifecycle integration and platform client IP lookup.

Some documentation websites were denied by the cloud egress policy; official
repository/package sources were used where available. No deployed Vercel project
or live Neon connection has been inspected or verified.

## Authentication and privacy

- Passwords are salted scrypt hashes, 12–128 characters. Unknown emails still
  incur derivation work to reduce timing-based discovery.
- Random 256-bit session cookies are stored as SHA-256 digests in PostgreSQL.
  Cookies are HttpOnly, SameSite=Strict, and Secure in production. Authenticated
  sessions expire after 12 hours; anonymous CSRF sessions after 30 minutes.
- Sign-in/logout rotate sessions. Password changes revoke other sessions;
  deactivation and permission changes revoke all of the member's sessions.
- Every protected request reloads membership. Lab access requires both completed
  onboarding and approval. UI visibility is never the permission boundary.
- Every mutation requires an exact configured Origin and session-bound CSRF token.
  The app never infers trust from arbitrary request Host values. Preview fallback
  uses Vercel's environment-provided deployment URL.
- API responses are `no-store`; the deployed frontend has CSP and framing
  protection. Logout clears React state, broadcasts to same-origin tabs, and sends
  Clear-Site-Data for cache/storage. Restored browser back/forward pages verify
  sessions. No service worker or local record cache exists.
- Login, registration, and password change share a per-client-IP limit of 30
  attempts per 15 minutes. Atomic PostgreSQL upserts enforce the limit across app
  instances and restarts. Keys hash normalized client IPs. On Vercel only the
  platform's client-IP header is used through the official SDK. Outside Vercel,
  proxy trust defaults to zero and must be deliberately configured.
- Expired sessions/rate-limit rows are cleaned during relevant requests; no
  background scheduler is claimed.

## Membership and permissions

Public registration requests membership; it never grants lab access. An
administrator verifies identity/email through a trusted channel before approval.
The first administrator is created by an interactive trusted-operator CLI, not a
public endpoint. There are no default passwords. The bootstrap refuses to promote
an existing email or create a second administrator. The bootstrap academic role
is unspecified, so administrative privilege does not invent an academic title.

| Capability                               | Pending applicant | Approved member/mentor/supervisor | Administrator            |
| ---------------------------------------- | ----------------- | --------------------------------- | ------------------------ |
| Own onboarding and password              | Yes               | Password; approved profile locked | Password                 |
| Eligible mentor names for onboarding     | Yes               | Yes                               | Yes                      |
| Active instrument register               | No                | Read                              | Read/create/edit/archive |
| Membership and privileges                | No                | No                                | Manage with reason/audit |
| Full membership email list and audit     | No                | No                                | Read                     |
| Progress review or supervisor operations | Not implemented   | Not implemented                   | Not implemented          |

Academic “Supervisor” cannot self-grant supervisor permission. Mentor/supervisor
application roles are stored for later phase-specific workflows, not treated as
administrators. Optional instrument-coordinator permissions await Phase 2.

Interns and Master's students choose approved PhD/Postdoc mentors or record a
pending assignment. Applicants see only eligible names/IDs/academic roles, not
email addresses or lab records. When a mentor leaves, mentees are flagged for
reassignment and the former relationship is retained in the audit trail.

## Transactions and data integrity

All Phase 1 domain writes acquire a PostgreSQL row lock within their transaction.
This coordinates separate Vercel instances and protects last-administrator,
mentorship, approval, and optimistic-version invariants. Privileged write handlers
recheck the actor's current administrator permission inside that transaction.
The lock is intentionally coarse for this small configuration workload; later
booking workloads should use appropriate resource-level locks and constraints.

Stale instrument/membership versions return 409 instead of overwriting edits.
Changes and audit entries commit together. Audit triggers reject UPDATE/DELETE;
a trusted database owner still has physical control over the database.

The supplied 15 instruments are seeded with immutable seed keys. Repeat seeding
preserves edits and archives. The seven priority resources lead the dashboard.
The four furnaces retain their exact supplied maxima. Training names remain
unlinked entries; Akhil N and Akhila are distinct and no accounts are created.

RF/magnetron sputtering is initially one resource, and arc melting/sealing is one
resource. Administrators can create separate resources and archive the combined
entry later. “Available” is an unverified initial configuration value; it is not
live use, operating authorization, or a free booking slot. No equipment limits,
accessories, operating recipes, or institute allocations are invented.

## Later phases

- Add migrations for samples and bookings, with database constraints/triggers
  protecting overlapping resource reservations, buffers, maintenance, cancellation,
  and simultaneous attempts. PostgreSQL exclusion constraints are a suitable
  option. Booking concurrency is not claimed in Phase 1 because bookings do not
  exist yet; current concurrency tests cover membership/configuration edits.
- Snapshot measurement/sample descriptions for historical bookings.
- Use exact decimals or integer minor units for money, never floating-point totals.
- Add private object storage and authenticated, validated uploads/downloads when
  attachments are implemented. Vercel filesystem persistence is never suitable.
  Phase 1 SOP URLs must refer to independently access-controlled documents.
- PWA, email/push, automated facility watchers, and server reminders are deferred.
