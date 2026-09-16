# Mobile Day background-calendar overlap

## Changes
- Keep babysitter/coverage events full-width at their exact times as a muted secondary layer with a thin rail and no shadow.
- Change only phone Day foreground activities: right-align them over coverage, using about 72% width when they cover the coverage label area and about 84% when they begin below it.
- When foreground activities overlap each other, divide only the right-side foreground area; cap dense overlap groups with the existing `+N more` control.
- Tighten phone Day card radius, padding, shadow, and badges while preserving titles, compact times, tapping, dragging, and exact timing.

## Technical details
- Scope all new placement and styling to `isMobile && visibleDays === 1`; keep mobile 3-Day and desktop/tablet behavior unchanged.
- Derive whether coverage text is obstructed from actual occurrence times and the existing rendered label height, rather than shrinking for any overlap anywhere.
- Reuse existing lane calculation, occurrence actions, category colors, and overflow control.
- Validate focused type checking, whitespace, and the preview build only; no broad QA.
