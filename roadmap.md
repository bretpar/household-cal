# Roadmap

## Calendar horizontal navigation physics
- [x] Mobile 3-Day: continuous strip of single-day columns (~viewport/3 wide), one persistent horizontal scroll surface, snap one day at a time, buffered offscreen days, rebase only after settle with zero visible movement.
- [x] Mobile Day: same strip with one full-width column per snap point.
- [x] Soft settle for the day strip (month + desktop keep their existing page carousel): velocity + distance aware, ~30-35% threshold or fast flick, brief coast then ease-out settle 250-400ms proportional to remaining distance, no bounce, no visible rebase jump.
- [x] Header label updates only after settle; preserve vertical scroll, current-time positioning, event placement, long-press drag, filters, data, desktop Week.

## Month view header handoff
- [x] Header month driven solely by the week row containing the 1st (data-month-start), measured against the scroll container's top edge with ~1.5px tolerance.
- [x] Harden anchor detection against variable row heights (rect-based measurement, sorted anchors, no offsetTop).
- [x] Subtle crossfade/slide when the fixed month/year text changes; text-only, no scroll or layout change.

## Calendar interaction polish
- [x] Month view: horizontal swipe follows the finger and settles to the next/previous month; vertical scrolling untouched.
- [x] Arrow steps match the view: month = 1 month, week = 1 week, mobile 3-Day = 3 days, day = 1 day.
- [x] Day, mobile 3-Day, and Week: long-pressed events follow vertical finger movement on the time scale, fully lock calendar scrolling until release, and save through the existing reschedule flow.

## Settings organization
- [x] Group routine settings into consistent collapsed Household, Calendars & Sync, Event Settings, and Account sections.
- [x] Keep all repair, diagnostic, and QA controls inside locked, collapsed Maintenance.
- [x] Preserve normal sync status, account/calendar controls, and informational timezone mismatch notices.
