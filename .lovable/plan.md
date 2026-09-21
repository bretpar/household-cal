# Focused Settings and Calendar UX Polish

## Settings
- Reorder the existing collapsible groups into Calendar, Sync & Integrations, Notifications / Emails, Household, Account, and a visually secondary Advanced / Maintenance area.
- Keep calendar defaults, week start, categories, and appearance together under Calendar.
- Keep Google and Apple connection, calendar selection, refresh, status, and disconnect controls under Sync & Integrations; keep email summaries in their own Notifications / Emails section.
- Keep members, caregivers, invitations, and access together under Household.
- Preserve the existing locked Maintenance area and move no diagnostic, repair, backfill, QA, or developer controls into normal sections.
- Simplify section descriptions and visible sync wording where possible without removing actionable status, connection, or recovery controls.

## Day / 3-Day / Week event cards
- Keep the shared timeline engine and stable lane ordering unchanged.
- Refine the shared content plan so title remains first, concise time appears before badges, and badges only appear when the remaining width and height support them.
- Use shorter same-meridiem ranges such as `10–11a` and `3:30–5p` while retaining unambiguous ranges such as `9a–1p`.
- Make the smallest safe width-threshold adjustment so a usable narrow card is preferred over `+N more`, while retaining the minimum readable/tappable floor and existing single overflow control.
- Leave Month view, background layering, event timing, interactions, and calendar behavior unchanged.

## Event form
- Retain the current shared Start and End rows.
- Confirm narrow screens stack date and time fields without overlap, while tablet and desktop retain the compact side-by-side layout; adjust only the responsive grid sizing if needed.

## Validation
- Run focused calendar-layout and directly related formatting checks, a TypeScript check, and confirm the preview build is clean.
- Do not run broad QA or regression suites.
