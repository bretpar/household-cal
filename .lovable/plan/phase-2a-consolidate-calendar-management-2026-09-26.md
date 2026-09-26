# Phase 2A: Consolidate Calendar Management

## Settings structure
- Keep default-view, week-start, and category controls in the existing Calendar section.
- Make **My Calendars** the sole routine calendar-management area by placing the existing Google and Apple controls directly with the existing unified calendar list.
- Remove the redundant **Sync & Integrations** section after its controls have moved.

## Calendar management
- Add a compact per-calendar **Manage** expander so appearance controls remain available without crowding the calendar list.
- Preserve OFC create, rename, archive, color, icon, and display-mode actions.
- Reuse the existing Google account, add/create calendar, two-calendar limit, status, refresh, replace, disconnect, and title-initial controls without changing their APIs or behavior.
- Reuse the existing Apple add, refresh, remove, read-only, and subscription status controls without changing import behavior.

## Protected tools and safety
- Leave Google diagnostics and maintenance in the existing locked Advanced / Maintenance area.
- Do not change calendar data, event destinations, sync rules, permissions, database structure, or OAuth behavior.

## Verification
- Rely on the automatic build check only; do not run browser testing or broad QA.
