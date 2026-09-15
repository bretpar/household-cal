# Responsive phone calendar views

## Change
- Track phone portrait versus landscape orientation in the existing calendar page.
- In phone portrait, show only Month and Day controls.
- On entering phone landscape, temporarily switch to the existing Week view.
- On returning to portrait, restore the last portrait Month or Day selection.
- Leave tablet and desktop controls and behavior unchanged.

## Technical details
- Keep the change inside the calendar presentation layer and existing mobile breakpoint utilities.
- Do not alter event rendering, positioning, drag/create behavior, sync, or stored preferences.
- Validate the focused code path and current build status only; no broad QA.
