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
- [x] Remove duplicate calendar visibility controls and consolidate persistent Event/Background choices into a compact Calendar Appearance list.
- [x] Replace the week-start switch with a Sunday/Monday segmented choice and separate Maintenance under Advanced.
- [x] Polish the hierarchy into Calendar, Sync & Integrations, Notifications / Emails, Household, Account, and locked Advanced / Maintenance.

## Shared event-card polish
- [x] Prioritize title, compact time, then member badges across Day, 3-Day, and Week.
- [x] Prefer another readable narrow event column before shared overflow, without changing stable lane behavior.
- [x] Keep Start and End controls stacked on narrow screens and compact side-by-side on larger screens.

## Durable manual Google sync
- [x] Queue accepted manual syncs through the existing durable scheduled-callback mechanism.
- [x] Await reconciliation inside the callback and always release the matching lock with durable failure status.
- [x] Preserve fast acknowledgement, duplicate prevention, and existing Settings polling.

## Event date and time controls
- [x] Add explicit Start and End date/time rows that preserve overnight and multi-day events.
- [x] Group All day and Repeats into one compact secondary control row.

## Apple subscription display
- [x] Add per-subscription Event or Background display style, defaulting new subscriptions to Event.
- [x] Reuse the shared background layer without changing Apple importing, read-only protection, or Google sync.
- [x] Keep shared overflow markers unique per overlap group and hidden occurrence.

## Mobile calendar readability
- [x] Remove the temporary caregiver coverage summary from Today without changing coverage data.
- [x] Stack overlapping mobile 3-Day events at readable width, with compact overflow for dense groups.
- [x] Preserve Day, larger-screen overlap lanes, the 45px hour scale, and vertical timeline scrolling.
- [x] Improve mobile Day/3-Day timed-card cascade widths, content space, and 44px touch targets.
- [x] Keep phone Day babysitter coverage full-width while foreground activities adapt around its label and each other.

## Landing page redesign
- [x] Rebuild signed-out homepage with requested sections, real product screenshots, FAQ/JSON-LD, and improved SEO/OG metadata.
- [x] Ship a polished mobile layout alongside desktop: stacked hero, responsive comparison, phone showcase, compact header/CTAs.

## Calendar appearance (colour + icon per calendar)
- Done: per-calendar colour (curated palette) and optional icon for Google + Apple calendars, stored on calendar_sources (color, display_icon).
- Done: shared appearanceForEvent resolves colour/icon for every view; Background calendars auto-render the muted form of the same colour (no extra opacity setting).
- Done: settings controls in Calendar > Calendar appearance; presentation metadata only, never pushed to Google/Apple.

## Phase 2A: consolidated calendar management
- [x] Make My Calendars the single routine area for OFC, Google, and Apple calendar management.
- [x] Add compact per-calendar Manage panels while preserving appearance and OFC lifecycle controls.
- [x] Move existing Google and Apple connection controls out of the redundant Sync & Integrations section.
- [x] Keep diagnostics and repair tools in locked Advanced / Maintenance.
