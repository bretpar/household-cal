# Mobile 3-Day Readability

## Changes
- Remove the caregiver coverage banner from Today without changing coverage data or calendar rendering elsewhere.
- Keep Day and larger-screen overlap lanes unchanged.
- In narrow-screen 3-Day timelines, group overlapping timed events by time region, render readable full-day-column cards in a compact vertical stack, and cap dense groups with a `+N more` indicator rather than narrowing every card.
- Keep the centralized 45px hour scale, vertical scrolling, event times, taps, long-press movement, creation gestures, colors, and badges unchanged.

## Technical details
- Activate the stacked treatment only when the shared timeline is mobile and displaying three visible days.
- Reuse existing overlap detection, card content, and event typography; only placement changes for that mode.
- Preserve each displayed card's occurrence key, drag handlers, keyboard activation, and normal open action.
- Validate the focused files with type checking and the preview build only; no browser QA or broad regression suite.
