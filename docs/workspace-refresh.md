# Clearer workspace layout

Prepared on 27 October 2026 from released main `1e59bc9`. This is an application-only UI preview; it does not authorize a production release.

## Changes

- Group the existing destinations into Lab work, Coordination and Workspace. Keep all destinations, permission checks, hashes and unsaved-draft guards.
- Use a quiet navy sidebar, consistent spacing and a single page heading. Let the desktop sidebar scroll at short viewport heights.
- Keep Overview focused on instrument activity, with issues, meetings, weekly work and orders in a separate column on wide screens.
- Replace the oversized welcome cards and statistic cards with a compact task strip and inline instrument counts. Full instructions remain in Quick Guide; the existing hide/restore preference is retained.
- Use compact instrument rows with separate current-usage and next-reservation fields. Keep current operators, samples, measurement types, timing, overruns, real handovers and furnace unloading visible. Move only empty handover messages and training details into Instrument details.
- Add category filters to the priority instruments using their configured categories. Filters do not change instrument availability or any booking.
- Collapse repeated empty issue and meeting subsections into concise, scope-specific empty states. Preserve error and loading states.
- Keep phone navigation at the bottom, with a grouped, scrollable More menu, Close menu and Escape support. Inbox and Sign out remain reachable in the top bar.

## Review

Check Overview, Quick Guide, calendar and an editable weekly draft at desktop, tablet and phone widths. Review a running measurement, overdue furnace, next booking, handover, urgent issue and pinned notice using isolated synthetic records. Confirm that all four furnaces remain separately accessible and that hiding/restoring tips still belongs to one account/browser.

Existing browser tests cover account permissions, registration, unsaved drafts, monitoring freshness, retained handovers, notifications and lifecycle workflows. Additional layout coverage checks category filtering, the phone menu and Escape focus return, narrow-screen overflow, accessibility and navigation to actual workflows. CI retains workspace screenshots with the existing review images.

No new dependencies, services, fonts, images, migration or production configuration. No production fixtures or records are used. Exact validation results belong in the PR; pending checks are not passes.
