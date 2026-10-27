Build a private, multi-user laboratory management app called “QuEMat Lab Hub”.

LAB DETAILS
- Group: QuEMat.
- Institution: IISER Thiruvananthapuram.
- Supervisor: Dr Deepshikha Jaiswal Nagar.
- Group website: https://sites.google.com/iisertvm.ac.in/quemat
- Default timezone: Asia/Kolkata.
- Default currency: INR.
- This is an operational lab app for daily coordination and weekly monitoring.

WORKING APPROACH
Read this entire specification before implementing anything. Build it in the numbered phases I request. Implement only the requested phase, while keeping the architecture compatible with later phases.

Inspect any existing repository and its instructions first. Preserve working functionality. Make reasonable implementation choices independently. Ask questions only when missing information materially blocks progress.

Save this specification as docs/requirements.md and maintain docs/progress.md with completed features, validation results, assumptions, setup requirements, and the next phase.

Build working features with persistent data, validation, permissions, and useful error states. Do not present decorative buttons or mock workflows as complete functionality. Keep demonstration data clearly separated from real lab records.

1. PRODUCT PRIORITIES

The highest-priority resources are:
1. PPMS.
2. SQUID.
3. Four individual furnaces.
4. Magnetron/RF sputtering.

Make the following prominent:
- Who is taking the measurement or running the experiment.
- Sample ID and compound.
- Measurement or process type.
- Scheduled start/end and actual status.
- Next booking.
- Relevant handover notes and problems.

Trained-user information is secondary. Put it inside an expandable “Instrument details” area or a small information panel. Do not place large trained-user lists on dashboard cards. Training records and actual booking operators are separate concepts.

2. ACCOUNTS AND FIRST-LOGIN ONBOARDING

Require authentication and onboarding before accessing lab records.

Collect:
- Full name.
- Email.
- Academic role: PhD student, Postdoc, Master’s student, Intern, Supervisor.
- Research topic/project, optional.
- For Master’s students and interns: supervising PhD student or Postdoc, selected from approved members.
- Permit “Mentor assignment pending” if the relevant person has not joined, and flag it for administrator review.

Keep academic role separate from application permissions.

New members must be invited or approved. Selecting “Supervisor” during onboarding must not grant supervisor privileges. Use a secure, documented process to establish the first administrator and approve privileged accounts.

Default permissions:
- Members: view shared lab schedules, manage their own bookings and submissions, report issues, request chemicals.
- Mentors: view mentee updates and comment; no automatic access to all administrative functions.
- Supervisor: review progress, approve requests, assign tasks, call meetings, publish announcements, manage lab operations.
- Administrator: manage membership, instrument settings, and app configuration.
- Instrument coordinator: optional permissions scoped to specified instruments.

Support deactivating departed members while preserving their historical records.

3. HOME DASHBOARD AND NAVIGATION

Dashboard sections, in this order:
- Priority instruments: PPMS, SQUID, each furnace, sputtering.
- Today’s schedule and next available/booked slots.
- Items requiring attention.
- My upcoming measurements, tasks, and deadlines.
- Pinned supervisor announcements and next meeting.
- Weekly progress summary and upcoming external-facility deadlines.

Distinguish “scheduled now” from “confirmed in use”. A booking alone does not prove that an instrument is running. Show manual check-in/check-out status and when it was last updated.

Supervisor dashboard additionally shows:
- Updates awaiting review.
- Missing weekly submissions.
- Unresolved requests addressed to the supervisor.
- Approvals and approaching proposal deadlines.

Suggested navigation:
- Overview
- Instruments & Calendar
- Weekly Progress
- Issues & Requests
- Meetings & Notices
- Samples
- Chemicals & Orders
- External Samples
- Facility Calls & Proposals
- Settings

Group secondary destinations under “More” on small screens.

4. INITIAL INSTRUMENT REGISTER

Seed these resources as editable configuration:

| Instrument | Maximum temperature | Trained users supplied by the lab |
|---|---|---|
| PPMS | Not specified | Not specified |
| SQUID | Not specified | Akhil N |
| Indufurr Furnace 1 | 1050 °C | Not specified |
| Indufurr Furnace 2 | 1050 °C | Not specified |
| Ants Furnace | 1200 °C | Not specified |
| Carbolyte Furnace | 1400 °C | Not specified |
| P-XRD — user-provided label “Brooker XRD” | Not specified | Akhil N |
| Single-crystal XRD | Not specified | None currently listed |
| Thin-film XRD | Not specified | Saptaparna, Aparna |
| Raman | Not specified | Akhil N |
| UV | Not specified | Akhil N |
| BET | Not specified | Akhila |
| RF / Magnetron sputtering | Not specified | Saptaparna |
| Arc melting and sealing setup | Not specified | Aparna, Jaydev |
| Cryostat | Not specified | Akhil N, Saptaparna |

Preserve supplied names and labels; allow administrator corrections. Akhil N and Akhila are different people.

Initially treat RF/magnetron sputtering as one resource, with this assumption documented and an easy way to split it if the lab has separate systems. Likewise, allow the arc-melting and sealing setup to be split later.

Do not invent emails, create authenticated accounts for named people, infer equipment specifications, or interpret an empty training list as approval to operate. Training names may initially be unlinked directory entries.

Instrument settings should include:
- Name, category, location, description.
- Operational status: available, maintenance, out of service.
- Booking rules and optional coordinator approval.
- Setup/cleanup buffers.
- Optional training policy.
- Trained-user records and supporting SOP links.

5. BOOKINGS AND MEASUREMENT DETAILS

Provide day/week/month calendar views and a readable mobile agenda.

Every booking records:
- Instrument.
- Person booking.
- Person actually operating/taking the measurement.
- Additional participants, optional.
- Sample or multiple samples.
- Compound/formula and project.
- Measurement/process type.
- Scheduled start and end.
- Status: requested, confirmed, in progress, completed, cancelled, interrupted.
- Setup requirements and notes.
- Actual start/end.
- Completion summary, data link, and handover notes.

Common PPMS measurement choices:
- Magnetization/VSM.
- Heat capacity.
- Resistivity/transport.
- ADR/magnetocaloric.
- Other.

These are editable choices, not claims that every accessory is installed.

PPMS and SQUID forms should support:
- Temperature and field ranges with units.
- Measurement sequence, such as M(T), M(H), ZFC/FC, relaxation, or custom.
- Sample mass and mounting notes.
- Required accessories/configuration.

Furnace forms should support:
- Samples and responsible operator.
- Target temperature.
- Ramp/hold/cooling stages, optional.
- Atmosphere and crucible notes.
- Planned occupancy including cooling time.
- Actual run and unloading status.

Reject requested temperatures above each configured furnace maximum. Do not declare a furnace free automatically when a heating timer ends; require completion/unloading confirmation.

Sputtering forms should support:
- Target material.
- Substrate.
- RF/DC mode if applicable.
- Gas, pressure, power, duration, and intended thickness, with units.
- Preparation, completion, and cleaning notes.

Do not invent operating limits or recipes.

Prevent overlapping reservations for the same exclusive resource at the database/server level, including simultaneous booking attempts. Include buffers and maintenance blocks. Permit adjacent bookings when buffers allow. Cancelled/rejected reservations must release their slots.

Where instruments have institutionally allocated slots, particularly PPMS:
- Support optional availability windows and allocation reference.
- Allow lab bookings within those windows.
- Default to the lab’s configured scheduling mode rather than inventing institute allocations.
- Distinguish an internal reservation from an officially approved facility slot.

Support check-in, completion, cancellation, rescheduling, and overrun reporting. If an experiment overruns, flag the impact on the next booking without silently moving another person’s reservation.

This app tracks operations; it does not directly control instruments.

6. SHARED SAMPLE REGISTER

Assign each sample a stable unique ID. Store:
- Compound/formula.
- Batch and preparation date.
- Owner/project.
- Internal or external origin.
- Physical form and quantity/mass, optional.
- Storage location.
- Notes and relevant handling information.
- Links to bookings, furnace runs, external requests, and result files.

Allow several batches of the same compound and multiple samples per booking. Preserve historical measurement details if a sample’s current description changes.

Provide quick sample creation from a booking form.

7. WEEKLY PROGRESS

Each member submits:
- Work completed this week.
- Experiments and samples measured.
- Main results or observations.
- Problems/blockers.
- Plan for next week.
- Help or decisions needed.
- Optional attachments or data links.

Let users select linked bookings and tasks to include, then review the summary before submitting.

Support private drafts and submitted reports visible only to the author and the application supervisor. Mentors, other members and administrators cannot read other people’s reports, discussions, review summaries or notification links. The supervisor provides comments and follow-up actions. Keep submission timestamps and revision history.

Provide supervisor views by person, project, and week, with submitted/missing indicators and a printable weekly meeting summary.

Use factual summaries. Do not introduce public productivity rankings or score research quality by booking hours.

8. ISSUES, REQUESTS, AND SUPERVISOR ATTENTION

Create a shared issue/request workflow for:
- Helium refill.
- Instrument malfunction.
- Consumables or maintenance.
- Proposal-writing needs.
- Purchase approval.
- Measurement assistance.
- General supervisor decisions.

Fields:
- Title, category, description.
- Priority.
- Related instrument/sample/project.
- Reporter and assignee.
- Due date, optional.
- “Supervisor attention requested”.
- Attachments and comments.
- Status: open, acknowledged, in progress, blocked, resolved.

Show urgent open items and supervisor-directed requests prominently. Record who acknowledged and resolved each item.

A helium refill report can track an observation and requested action; do not imply automatic level sensing.

9. MEETINGS AND SUPERVISOR ANNOUNCEMENTS

Allow the supervisor or explicitly delegated members to:
- Schedule group or individual meetings.
- Select attendees.
- Add agenda, venue/video link, and attachments.
- Publish, pin, and expire announcements.
- Request acknowledgement for important notices.

Include meeting notes and action items with an owner and due date. Show upcoming meetings on the dashboard and provide calendar export.

10. CHEMICAL REQUESTS AND ORDERS

Track:
- Chemical name/formula, optional CAS number.
- Purity/grade and quantity with units.
- Supplier.
- Requester.
- Person who placed the order.
- Requested, ordered, expected-delivery, and received dates.
- Unit price, total cost, currency, and optional tax/shipping.
- Purpose/project and optional funding reference.
- Quotation/invoice attachments.
- Status: requested, awaiting approval, approved, ordered, partially received, received, cancelled.
- Received quantity and storage location.

Separate approval from recording that an order was placed. Do not implement automatic purchases.

Provide search to identify similar pending requests and avoid duplicate orders. Allow simple stock tracking and manual low-stock thresholds after receipt.

11. EXTERNAL SAMPLES RECEIVED BY OUR LAB

Keep this distinct from our samples sent to external facilities.

For incoming samples record:
- Sender’s name, institution, and contact details.
- Date received.
- Sample IDs, compounds, quantity, and condition.
- Requested measurements and conditions.
- Responsible QuEMat member.
- Agreed due date.
- Linked bookings.
- Status: received, clarification needed, queued, measuring, analysis, results delivered, closed.
- Report/data links.
- Return/disposal instructions and completion record.
- Optional service charge or quotation reference.

Use the shared sample register to avoid duplicate identities. Restrict sender contact details and confidential attachments to authorized people while retaining useful shared schedule visibility.

12. EXTERNAL FACILITY CALLS AND PROPOSALS

Track opportunities for:
- Inelastic neutron scattering (INS).
- Muon spin spectroscopy (μSR).
- Dilution-refrigerator measurements.
- ARPES.
- Other external techniques.

Support both formal proposal calls and collaboration/service-based access. Not every facility uses a call.

Each opportunity should include:
- Facility, instrument/beamline, technique, country.
- Official source URL.
- Opening date, deadline, and deadline timezone, when confirmed.
- Expected measurement period.
- Eligibility/access notes.
- Responsible lab member.
- Related project and samples.
- Internal drafting deadline.
- Last verified date and verification status.

Keep opportunity status separate from our proposal status.

Proposal workflow:
Interested → planning → drafting → internal review → submitted → accepted/rejected/withdrawn → scheduled → measurements completed → analysis.

Allow unknown dates. Never fabricate open calls, deadlines, acceptance, or recurring schedules.

Start with manual entry and official links. A later automatic watcher may suggest changes from configured official sources, but it must retain source evidence and flag uncertain or changed dates for human review. If automated checking is not configured, show this explicitly.

For accepted measurements, track sample readiness, shipping, assigned attendees/operators, measurement dates, and follow-up analysis.

13. REMINDERS AND NOTIFICATIONS

Provide a persistent in-app notification inbox.

Support configurable reminders for:
- Upcoming bookings.
- Changed/cancelled bookings.
- Handover and overruns.
- Weekly progress submissions.
- Meetings.
- Assigned issues and approvals.
- Proposal and internal drafting deadlines.
- Expected chemical deliveries.

Suggested starting offsets:
- Bookings: 24 hours and 1 hour.
- Proposal deadlines: 30, 14, 7, and 1 day.
- Weekly submissions: configurable weekday/time.

Only schedule future reminders. Cancel or update pending reminders when the source event changes. Prevent duplicate delivery on retries.

Email and web-push are optional later integrations requiring configured providers and user preferences. Reminders intended to work while the app is closed must use a real server-side scheduler.

Clearly distinguish in-app notifications from delivered email/push. Do not claim background delivery works without testing it.

14. DESIGN AND USABILITY

Use a clean, restrained academic style:
- Light neutral background, navy/teal accents.
- Strong readable typography and generous spacing.
- Compact but legible instrument cards.
- Status shown through text and icons as well as colour.
- Accessible contrast and keyboard navigation.
- Mobile-friendly forms and large touch targets.
- Optional dark mode if it does not delay core functionality.
- Subtle transitions with reduced-motion support.

Make frequent actions easy: book a slot, submit progress, report a problem, request a chemical.

Use progressive disclosure for technical fields. Avoid cramped dashboards, unnecessary charts, oversized decorative banners, and gamification.

Useful charts can include instrument scheduled/completed hours and issue trends, with clear definitions. Research progress should remain understandable through summaries and milestones.

15. ENGINEERING REQUIREMENTS

Use a maintainable TypeScript web stack with a relational database, authentication, and private attachment storage. Reuse the existing stack if suitable. Choose and document specific dependencies using their current official documentation.

Make the app installable as a PWA after core workflows work. Do not let offline users create apparently confirmed bookings. Clearly distinguish offline drafts and stale cached schedules from server-confirmed state.

Use:
- Database migrations and repeatable seed scripts.
- Server-enforced authorization.
- Database-level booking conflict protection.
- UTC timestamp storage and timezone-aware display.
- Exact decimal handling for monetary amounts.
- Private attachment access and appropriate file validation.
- Audit history for role changes, bookings, approvals, and important edits.
- Environment-variable templates without secrets.
- Backup/export and recovery instructions.

Preserve historical records when users or instruments are archived.

Keep private data out of public pages and unprotected file links. Clear sensitive cached data on logout. Never rely on hiding UI controls as the only permission check.

If credentials or external services are unavailable, implement the local/development path and document the exact setup needed. Never describe local demo storage as a functioning shared production backend.

VALIDATION AND DELIVERY

At each phase:
- Implement the requested workflows end to end.
- Run relevant build/type checks and meaningful tests.
- Test permissions and scheduling concurrency where applicable.
- Check phone and desktop layouts.
- Update requirements/progress documentation.
- Explain what works, what was tested, and what remains dependent on configuration.

Do not claim live deployment, background notifications, automated call monitoring, or production readiness unless those functions were actually configured and verified.

## Supervisor privacy and notification policy — 28 October 2026

The lab has one supervisor. Her existing application role grants lab-wide monitoring; this does not automatically subscribe her to routine work. Academic titles do not grant application permissions.

- Weekly reports: authors see their own draft/history; only the supervisor can read everyone’s submitted reports, discussions and printable summaries. Drafts remain private. This also applies to administrators’ own submissions. No routine submission alerts are broadcast; the supervisor checks the review queue when needed. Feedback/review alerts go to the author. Existing report notifications must be filtered using current access permissions.
- Issues: assign routine work to a responsible senior PhD member/postdoc. Reporter, assignee and lab managers can request or clear supervisor attention. Supervisors receive escalation, cleared escalation, resolution and reopening alerts, rather than every edit, acknowledgement or comment. All issues remain visible when the supervisor opens the app. Escalation does not itself acknowledge an issue.
- Routine booking approval, order and unrelated meeting broadcasts go to administrators rather than supervisors. A supervisor still receives relevant notifications when directly involved as a booking participant, order requester/handler or meeting attendee. Published lab notices remain visible/notified to the lab.
- This changes application access and notification routing, not academic assignments, database schema, existing records or accounts. No extra paid service or background reminder job.
