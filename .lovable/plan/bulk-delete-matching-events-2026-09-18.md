# Bulk Delete Matching Events

## Goal
Add an owner-only destructive tool inside the existing locked Calendar Maintenance area. It will preview and then delete only standalone events matching one connected calendar, an exact event title, an inclusive date range, and optional start/end times.

## Implementation
- Add a focused server-only maintenance helper that:
  - resolves the owner’s household and selected connected calendar;
  - reads expanded Google events and OFC events in the requested household-timezone range;
  - compares normalized exact titles (including the app’s generated Google-initial suffix handling), dates, and optional times;
  - excludes recurring masters and occurrences so unrelated recurring series cannot be changed;
  - merges Google and OFC/link rows into one preview list marked `Google`, `OFC`, or `Both`.
- Add authenticated server functions for preview and confirmed deletion. Both re-check household ownership and all filters server-side; deletion re-runs the match and refuses to proceed if the preview set changed.
- For each confirmed match:
  - delete its Google event first when present or linked;
  - only after Google succeeds, delete the matching OFC event/link;
  - delete OFC-only events directly;
  - continue through individual failures and return Google/OFC deletion counts plus actionable failures.
- Add a compact `Bulk Delete Matching Events` panel inside the already-unlocked Maintenance UI with:
  - calendar, title, start/end date, optional start/end time filters;
  - `Preview matches` action and a read-only match list;
  - a separate destructive confirmation summary and `Delete X matching events` button;
  - completion counts and failures.
- Clear the preview whenever any filter changes, preventing confirmation against stale visible criteria.

## Security and safety
- Owner authorization remains server-enforced; editors/viewers cannot call preview or delete directly.
- Calendar and every matched row are constrained to the owner’s household.
- The tool remains visible only after the existing maintenance-code unlock.
- No schema, normal calendar behavior, recurrence logic, or sync architecture changes.

## Focused verification
- Add narrow tests for exact filtering, optional times, source merging, recurring-event exclusion, stale-preview rejection, and per-item failure handling.
- Run only the focused tests plus the required compile/build checks.
