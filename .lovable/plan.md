# Unified My Calendars controls

## Scope
- Keep one My Calendars list with compact mobile-friendly Manage panels.
- Move each Google calendar's status, main selection, replace, and disconnect actions into its matching calendar panel.
- Move each Apple calendar's read-only status, refresh details, refresh, and remove actions into its matching calendar panel.
- Keep appearance, rename, and archive controls with the calendar they affect.

## Account and add flows
- Refactor the existing Google controls into one compact account-level expander for account status, sync, disconnect, title initials, and reconnect.
- Replace the separate provider add controls with one Add Calendar action offering OFC, existing Google, new Google, and Apple subscription workflows when available.
- Reuse the existing dialogs, mutations, limits, permissions, and server functions without changing behavior.

## Cleanup and layout
- Remove standalone Google and Apple panels and duplicate calendar rows or explanatory copy.
- Use narrow-screen-safe grids and wrapping controls, and preserve enough bottom spacing above fixed navigation.
- Leave Event Categories and protected maintenance unchanged.

## Validation
- Rely on the automatic build check only; no broad QA or browser testing.
