# Mobile timed-event readability

## Changes
- Apply a mobile-only overlap cascade to both Day and 3-Day timed events: background at full width, then approximately 78% and 63%, all sharing the same right edge and exact vertical timing.
- Show at most three simultaneous cards in those mobile views; represent any additional overlaps with the existing compact `+N more` control.
- Hide recurrence indicators on mobile Day and mobile 3-Day timed cards while leaving recurrence details and larger-screen cards unchanged.
- Reduce the mobile timed-event side inset and slightly tighten card padding so titles and compact times retain more width.
- Keep member badges when they fit, but compact dense badge rows on cramped mobile timed cards rather than allowing them to crowd out title and time.
- Replace the pseudo-element-only short-event hit expansion with a real, transparent 44px-tall interactive wrapper while preserving the visible card's exact top and height.

## Technical details
- Scope overlap, inset, padding, badge, recurrence, and hit-target changes to phone-sized timed events in `WeekView` and shared event content props.
- Keep the 40px mobile 3-Day time gutter, 45px/hour scale, event geometry, z-order semantics, drag/create handlers, keyboard activation, and open action.
- Leave desktop/tablet lane placement and all-day/coverage cards unchanged.
- Validate with focused type checking, whitespace checks, and the preview build only; no broad QA.
