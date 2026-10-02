# Timesheet Mobile UI Polish

## Changes
- Restyle all editable Timesheet start/end controls to match the Add/Edit Event modal: use the same polished time picker, with both times side by side and width constraints that prevent iPhone overlap; stack only at exceptionally narrow widths.
- Simplify shift cards into a clear date/hours header, scheduled-time line, “Actual” time row with an arrow between values, and optional note field. Keep a border around entries only while editing or when attention is required.
- Format displayed hours without trailing zeroes (`8 h`, `8.5 h`) while preserving the existing calculations and stored precision. Rename the card summary to `Total · … hours`.
- Simplify owner-managed pay-period headings to the date range plus a compact status badge, enlarge the subtle previous/next controls, and remove repeated “Owner-managed” wording.
- Rename the no-login caregiver action to “Confirm time card” without changing its approved status or workflow.
- Show “Save changes” only for an existing entry with unsaved edits, keep explicit saving, and give it less visual emphasis than the overall confirmation action.
- Add Timesheet-specific bottom spacing so every section scrolls fully above the fixed mobile navigation and safe area, without changing the navigation itself.

## Scope
- Apply the shared time-entry presentation to caregiver entry editing, owner review editing, and owner-managed entry editing.
- Preserve scheduled/actual calculations, overnight handling, notes, manual entries, permissions, status transitions, snapshots, pay-period behavior, assignments, privacy, calendar events, and sync behavior.
- Do not change the database or server-side Timesheet workflow.
- Do not run QA or broad tests; Codex will verify afterward.

## Technical details
- Reuse the existing `TimeField` control from the event form rather than native time inputs, retaining semantic design tokens and accessible tap targets.
- Keep the changes focused in the Timesheet presentation components and shared hours display helper; add only localized page spacing where needed.
