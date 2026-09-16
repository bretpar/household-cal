# Day and 3-Day timed-card content density

## Changes
- Keep timed-card titles visible at every height.
- Use each card's existing rendered pixel height to choose content: roomy cards show title, compact time, and badges; tighter cards drop time; the shortest cards show title only.
- Remove recurrence icons from Day and 3-Day timeline cards on mobile and desktop while preserving recurrence data and event details.
- Leave event geometry, overlap placement, styling, and interactions unchanged.

## Validation
- Run focused TypeScript and whitespace checks, then confirm the preview build succeeds; no browser or broad test suite.
