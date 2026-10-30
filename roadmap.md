# Roadmap

## Fixed phone Month and scrollable agenda
- [x] Keep month grid/date heading stationary; bound agenda to approximately three standard rows, shrinking to available height.
- [x] Isolate agenda gestures, reset on date changes, and track subtle overflow chevrons. No QA, tests or publishing; physical iPhone scrolling remains for Codex.

## Timed overnight visibility
- [x] Include nonrecurring timed continuations with original timestamps and end-exclusive midnight boundaries.
- [x] Show continuation dates/times in phone Month; two focused boundary tests pass in Pacific time and UTC. Automatic compilation passed; no broad QA or publishing.

## Mobile Month readability
- [x] Replace crowded phone Month cells with dates, three color indicators and overflow counts.
- [x] Show selected-day chronological agenda through existing event details; preserve larger layouts and date expansion.
- [x] Automatic compilation passed; no QA, tests or publishing. Physical iPhone rendering remains unverified; existing shared date/time behavior is unchanged.

## Native iPhone TestFlight UI fixes
- [x] Native-only signed-out welcome, preserving web marketing and existing authentication destinations.
- [x] Safe-area notification placement and inline password errors.
- [x] Clip native Day overflow at the 24-hour grid; account for strip headers during initial current-time positioning and ignore premature alignment scrolls.
- [x] Automatic compilation passed; no QA, tests, publishing or native build. Actual iPhone rendering and reported scrolling remain for Codex verification; these hosted UI changes require publication, not a fresh native build.

## Public legal entity identification
- [x] Identify Parker Med LLC in the public footer, Privacy Policy and Terms; confirmed public HTML on all three pages, without rebranding, broad QA or publishing.

## Onboarding polish and heart-reveal finish
- [x] Lock onboarding step/member state to the first status load so background refetches can't yank users off Step 2 or wipe edits.
- [x] Prefetch household access on Step 4 so the invitation dialog opens instantly.
- [x] Add a Step 4 completion card with colored member chips; "Go to Calendar" now plays the heart reveal via requestHeartReveal().
- [x] Sign-up with an already-registered email switches to sign-in with a clear message (invited users who already have accounts).
- [x] Type-check and 25 focused tests pass; no browser QA or publishing. The live heart reveal on a real fresh signup remains unverified.

## Step 4 invitations and onboarding copy
- [x] Open the existing invitation dialog directly from Step 4 with load errors and Retry; keep invitations optional.
- [x] Remove childcare explanation and add touch-friendly Timesheets information popover; keep default unchecked.
- [x] Automatic compilation passed; no browser QA, broad tests or publishing. Live invitation delivery and phone popover placement remain unverified.

## Mobile keyboard dialogs and optional childcare setup
- [x] Constrain shared phone dialogs to the visual viewport and keep focused fields scrollable without dismissing the keyboard.
- [x] Add unchecked expandable childcare setup with named OFC/Google creation and eligible existing destinations; preserve Settings and historical data.
- [x] Seven focused childcare tests and automatic compilation pass; no browser QA or publishing. Real iPhone keyboard/autofill and live Google setup remain for focused verification.

## Confirmed data-preservation blockers
- [x] Preserve existing shift assignments independently of the current childcare-calendar setting.
- [x] Save onboarding members by stable IDs, deleting only explicitly removed members.
- [x] Both focused preservation test files pass (20 tests); no browser QA or publishing. Automatic compilation checked separately.

## Simplify childcare setup and Settings
- [x] Replace onboarding checkbox/name with optional create, supported existing-calendar, and later choices; default to later.
- [x] Consolidate childcare Settings labels and reuse existing create/select helpers, without changing shifts or permissions.
- [x] Automatic compilation passes; no browser QA, broad tests or publishing. Existing OFC/Google selection is supported; Apple subscriptions remain ineligible. Targeted live setup checks are deferred.

## Optional onboarding calendar setup
- [x] Add optional calendar step with existing OFC, Google and Apple add flows and unchanged welcome/tutorial.
- [x] Add idempotent optional Babysitter calendar; preserve ownership and childcare behavior.
- [x] Focused duplicate-prevention tests and automatic compilation passed; no browser QA, broad tests or publishing. Provider imports can continue during setup completion; live OAuth and inbox/device checks remain unverified.

## Nanny scheduling search copy
- [x] Focus the existing childcare page on nanny schedule app searches, with clear scheduling, access and timesheet answers.
- [x] Update supporting public-page copy, metadata and links; preserve layout and app behavior, check preview diagnostics, leave unpublished.

## Caregiver submission email
- [x] Add an opt-in shared review layout and submission copy; preserve payloads, authenticated links, and other emails.
- [x] Automatic compilation check passes; existing logo URL returns HTTP 200. No QA, browser tests, regression suites, or publishing; real email-client dark mode remains unverified.

## Mobile Day / 3-Day native alignment
- [x] Replace custom mobile horizontal movement with gutter-aware native scroll snapping.
- [x] Commit dates only after actual settling; preserve event gestures and vertical position during navigation/rebasing.
- [x] Check focused source changes and preview diagnostics; no QA suites or publishing. Real iPhone Safari/WebView momentum and long-press interactions remain unverified.

## Childcare timesheet marketing
- [x] Add neutral timesheet comparison row and linked childcare explanation.
- [x] Emphasize the scheduled-to-actual workflow on the childcare page and parent confirmation on the homepage.
- [x] Verify comparison and childcare sections/links at desktop and phone widths; homepage text/link confirmed, but visual check blocked by existing opening overlay. Leave unpublished.

## Comparison-page trust and usability
- [x] Review desktop/mobile presentation and factual claims.
- [x] Fix comparison readability, claim qualifications, and signup links.
- [x] Verify page links, images, and sharing details in the preview.

## First-login app tour
- [x] Replace multi-page spotlights with four role-aware bottom-tab tips on Today.
- [x] Keep a fixed-size card and overlay; preserve completion persistence and Account replay.
- [x] Remove element tracking, menu opening, per-step navigation and readiness logic.

## Calendar horizontal navigation physics
- [x] Mobile 3-Day: continuous strip of single-day columns (~viewport/3 wide), one persistent horizontal scroll surface, snap one day at a time, buffered offscreen days, rebase only after settle with zero visible movement.
- [x] Mobile Day: same strip with one full-width column per snap point.
- [x] Mobile day strips use native mandatory horizontal snapping; desktop retains its trackpad soft settle, and Month keeps its existing carousel.
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
- [x] Keep each Start and End date/time pair side-by-side on narrow screens without overlap.

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
- [x] Move provider-specific actions into each calendar panel and consolidate all add flows behind one button.
- [x] Keep Google account-level sync controls in one compact expandable section.
- [x] Phase 2B: link empty OFC calendars to empty Google calendars (owner-only, 2-slot limit)

## Babysitter Calendar event validation
- [x] Reorder shared Add/Edit fields by calendar, preserve hidden state, and restrict assignment validation/submission to the Babysitter destination.
- [x] Let a Babysitter calendar event save with an assigned caregiver and no family members.
- [x] Keep requiring a family member on regular family calendars, and apply the same rule when editing.

## Bounded calendar event loading (V1 iPhone performance)
- [x] Range-scoped family bundle: views report visible dates, server fetches only overlapping events plus recurring masters.
- [x] Bound caregiver occurrence expansion to the viewed range; diagnostics keep the full window.
