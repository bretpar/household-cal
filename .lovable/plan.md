# Simplify Calendar Preferences in Settings

## UI changes
- Keep the existing default-view preference and replace the Monday switch with a Sunday/Monday segmented control using the same saved account preference.
- Remove disabled per-calendar visibility rows, their inactive helper text, and the duplicate “All my preferences” link.
- Add one compact Calendar Appearance list showing only sources that already support Event/Background display styles, with one-line selectors and a single filters helper note.
- Remove duplicate display-style controls from Google and Apple connection cards while preserving their connection, refresh, status, and removal controls.
- Keep Account separate, relabel the locked secondary area as Advanced, and retain Maintenance inside it near the bottom.
- Keep Privacy Policy, Terms of Service, and copyright in the footer.

## Technical details
- Reuse existing display-mode values and update functions; no schema, sync, permissions, event, or filter changes.
- Invalidate the existing calendar/settings queries after an appearance update so changes remain immediate and persistent.
- Check the focused Settings page layout and current build status only; do not run broad QA.
