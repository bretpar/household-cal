# Stable foreground overlap ordering

## Changes
- Update the shared timed-event layout engine only; Day, 3-Day, Week, and all device sizes inherit the same behavior.
- Build each foreground overlap group using a deterministic priority: earlier start, then longer duration, then stable occurrence key.
- Assign each event one lane for its full duration and preserve that lane, width, and horizontal position after neighboring events end.
- Keep coverage events beneath foreground cards and outside lane ordering and overflow counts.
- Preserve the existing width-based `+N more` behavior, adaptive card content, timing, interactions, and styling.
- Apply z-index from the stable lane order so higher-numbered lanes consistently render above lower-numbered lanes.

## Focused verification
- Update shared layout tests for duration and ID tie-breakers, input-order independence, stable lanes after partial overlaps, width-based overflow, and background exclusion.
- Run only the focused layout test and confirm the preview build remains healthy.
