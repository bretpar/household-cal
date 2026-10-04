# Header-aware timed-event overlap

## Changes
- Update the shared Day / 3-Day / Week timed-event layout so each card stays at its exact start and duration, while horizontal placement protects title-and-time headers.
- Estimate each header’s rendered height from the card width, current text scale, title length/wrapping, time row, and padding; use those pixel bounds to detect collisions rather than a fixed time threshold.
- Use two or three columns only while nearby headers collide. When a later header fits below earlier headers, keep the existing wide staggered overlap so it may cover card bodies without covering readable headers.
- Apply the same header-aware placement to overlapping background events, while allowing foreground activities to remain wide over background bodies when their headers do not collide.
- Preserve event colors, initials, tapping, dragging, overflow behavior, filters, and Month view.

## Technical details
- Extend the centralized calendar layout result to describe header-safe horizontal geometry for both foreground and background cards; keep rendering in the existing shared timeline component.
- Keep placement deterministic and width-aware, with no device-specific or view-specific branch.
- Add focused layout tests for the four supplied examples, including a wrapped title at mobile width and background-plus-foreground layering.
- Run only the focused calendar-layout tests and inspect the current preview build status.
