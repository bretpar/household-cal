# Reorganize Settings

## Layout

- Replace the current mix of standalone cards and collapsibles with five consistent top-level sections: Household, Calendars & Sync, Event Settings, Account, and Maintenance.
- Keep sections collapsed by default, with compact mobile-safe headers, clear icons, consistent spacing, and wrapped descriptions.
- Group family members and household access together; group Google connection, calendar controls, timezone notices, and email summaries together; group categories and display preferences together.

## Maintenance separation

- Keep all existing Google diagnostics, backfill, recurrence repair, occurrence inspection, and DST details inside the locked Maintenance section.
- Move the QA reset into that same Maintenance area so no diagnostic or destructive test control appears among routine settings.
- Preserve the existing owner checks, support-code lock, session timeout, and every tool’s current behavior.

## Account and behavior preservation

- Put the current signed-in access summary and sign-out action in Account.
- Preserve every existing setting and action without changing sync, events, permissions, data, or repair behavior.

## Verification

- Check the Settings page at narrow mobile and desktop widths for wrapping, tap targets, overflow, collapsed defaults, and successful section interactions.
- Confirm the app builds cleanly; do not run the broader QA suite.
