# Compact calendar sync status

## Goal
Replace the header’s icon-only sync display with a compact, tappable status that uses the existing Google Calendar sync data and action.

## Changes
- Show a colored dot and short label in the existing top-right header position: **Synced**, **Syncing…**, **Needs sync**, or **Sync issue**.
- Keep the visible control compact while maintaining a mobile-friendly touch target and accessible label.
- Open a small popover with the current connection status, last successful sync time, and the existing **Sync now** action when available.
- Refresh the existing calendar and sync queries after a successful manual sync, and show the existing success/error notifications.

## Scope
- Frontend only, limited to the existing header sync indicator.
- No changes to Google sync logic, backend behavior, data models, or permissions.
- No browser QA or broad tests.
