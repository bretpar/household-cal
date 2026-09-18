# Shared foreground overlap fix

## Scope
- Change only the unified timed-event layout engine and its shared renderer.
- Preserve calendar data, timing, backgrounds, interactions, styling, navigation, and sync behavior.

## Implementation
- Calculate the visible foreground lane capacity from the actual event-area width and shared minimum readable width.
- Always retain two real event blocks for exactly two simultaneous foreground events; use `+N more` only when additional lanes would be unreadable.
- Exclude background/coverage events from lane capacity and overflow counts.
- Split layout geometry at overlap start/end boundaries so a longer event can reclaim width after a shorter overlap ends, while preserving its exact vertical start and end.
- Keep stable foreground lane assignment within each overlap segment and emit overflow markers only for events hidden in that segment.
- Update the shared Day / 3-Day / Week renderer to consume segment placements without introducing device- or view-specific branches.

## Focused verification
- Add layout-engine tests for one event, two events in narrow space, width-aware 3+ overflow, background exclusion, and partial-overlap width recovery.
- Check the focused tests and current build status only; no broad QA.
