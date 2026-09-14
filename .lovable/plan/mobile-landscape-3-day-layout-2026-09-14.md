# Mobile Landscape 3-Day Layout

## Changes
- Apply a compact shell only while the phone Calendar is in 3-Day mode and landscape, leaving portrait, Day, and larger screens unchanged.
- Reduce vertical padding and control height in the top header, calendar navigation, view selector, filters, and bottom navigation.
- Give the 3-Day calendar the reclaimed height and keep its existing vertically scrollable 45px-per-hour timeline.

## Technical details
- Add a narrowly scoped Calendar shell option and landscape media styles limited to short screens below the mobile breakpoint.
- Do not alter event geometry, overlap placement, gestures, data, or calendar behavior.
- Validate with focused type checking and the preview build only; no browser or broad regression QA.
