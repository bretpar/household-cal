# Compact phone landscape calendar

## Change
- Keep portrait, tablet, and desktop layouts unchanged.
- In phone landscape, hide the branded app header and floating bottom navigation.
- Replace the two mobile calendar control rows with one short toolbar containing previous, date range, Today, a compact Month/Week/Day selector, filter icon, and add button.
- Preserve the current calendar view through rotation instead of forcing Week.
- Let the calendar fill the remaining viewport while retaining the existing vertically scrolling 45px/hour timeline.

## Technical details
- Scope changes to the authenticated app shell, calendar page presentation, filter trigger presentation, and the existing phone-landscape CSS media query.
- Do not change calendar data, event rendering, positioning, gestures, routes, or desktop/portrait behavior.
- Validate focused types/tests and the current build status only; no broad QA.
