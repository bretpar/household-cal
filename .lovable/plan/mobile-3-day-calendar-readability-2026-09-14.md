# Mobile 3-Day Calendar Readability

## Changes
- Narrow only the phone 3-Day time-label gutter from 52px to 40px, keeping the existing 10px hour labels aligned to the unchanged 45px/hour grid.
- Hide the repeat icon only on timed cards in the phone 3-Day view; recurrence remains unchanged in event details and all other calendar views.
- Replace the current two-card mobile overlap treatment with a four-level cascade: approximately 100%, 90%, 80%, and 70% width, with each later card layered above the earlier card and every card kept at its true start and duration.
- For overlap groups beyond four visible cards, keep the fourth card near 70% width and render a compact `+N more` control for the additional events instead of shrinking cards further.

## Technical details
- Keep the 40px gutter measurement synchronized between the mobile day strip and its timeline grid so exactly three wider day columns remain visible.
- Scope recurrence-icon and overlap changes to `isMobile && scaleDays === 3`; Day and desktop/tablet lane placement remain unchanged.
- Reuse existing occurrence keys, opening actions, keyboard handling, drag handlers, colors, typography, time ranges, and member badges.
- Validate with focused type checking, whitespace checks, and the preview build only; no browser QA or broad test suite.
