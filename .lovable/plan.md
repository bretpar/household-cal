# Add/Edit Event Date and Time Layout

## Changes
- Add an explicit end date to the existing event form state, initialized from the start date and loaded from saved event end times.
- Render Start and End as matching date-and-time rows with calendar/clock cues, responsive two-column layouts, and the current rounded input treatment.
- Automatically move the end date to the following day when an earlier end time is selected on the same date, while preserving explicit multi-day dates.
- Combine All day and Repeats into one subdued, divided control row; keep the existing recurrence settings beneath it when enabled.
- Preserve add, edit, paste, quick-add, recurrence, permissions, categories, people, and sync behavior.

## Technical details
- Reuse the existing `start_at` and `end_at` fields; no database change is needed.
- Update form conversion and validation so `end_at` uses the selected end date and edit mode round-trips overnight/multi-day events.
- Keep all-day events date-based and keep the current recurrence flow unchanged.
