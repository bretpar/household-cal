# Fix Confirmed Bulk Deletion

## Goal
Make confirmation delete the exact eligible Google and OFC event IDs shown in the approved preview, while preserving owner checks and healthy-series protection.

## Changes
- Include a stable eligible-target snapshot in preview results and submit that snapshot with the preview token.
- Revalidate the preview token and exact target snapshot server-side, then delete only those confirmed targets without applying a second eligibility filter.
- Support OFC-only targets, clean links safely, and retain Google-first ordering for linked targets.
- Return requested, Google-deleted, OFC-deleted, skipped, failed counts, plus event ID/title/date/reason for every failure.
- Keep the preview visible during deletion, automatically refresh it afterward, and retain failures/completion details instead of silently closing.

## Focused verification
- Add narrow tests for stable target identity, detached-target acceptance, changed-target rejection, and failure details.
- Run only the bulk-delete tests and required compile/build checks.
