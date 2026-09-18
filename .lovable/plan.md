# Apple subscription display style and overflow refinement

## Scope
- Add a per-Apple-subscription Display style control inside Family → Calendars & Sync.
- Keep Apple imports, read-only protection, recurrence, and Google sync unchanged.
- Refine only the shared Day / 3-Day / Week layout behavior for unique overflow markers.

## Implementation
- Store the selected style in each subscription’s existing calendar display mode: `events` for Event and `coverage_background` for Background.
- Default newly connected Apple subscriptions to Event.
- Add an authenticated update action that changes only the subscription source’s display mode, so existing imported rows immediately inherit the new rendering behavior without reimporting.
- Reuse the shared background classification and renderer for Apple subscriptions set to Background, preserving their selected source color and read-only click behavior.
- Keep Apple subscriptions set to Event in the existing foreground overlap/lane system.
- Ensure shared overflow markers are created once per overlap cluster from unique hidden occurrence keys, positioned consistently, with no background events included.
- Preserve the existing stable lane ordering and actual-card-first width rules.

## Focused verification
- Add focused layout coverage proving one hidden occurrence produces one marker and unique hidden-event lists.
- Add focused subscription coverage for Event default and display-mode updates.
- Run only the relevant calendar-layout and Apple subscription tests, then confirm the preview build is healthy.
