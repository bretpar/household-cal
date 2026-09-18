# Apple / iCloud calendar subscription (read-only)

A temporary bridge that lets a household paste an Apple/iCloud calendar share link and see those
events inside Our Family Calendar as read-only entries. Google sync is untouched.

## What you get in Settings

Inside the existing **Calendars & Sync** section, below the Google controls, a new
**Apple Calendar Subscription** block:

- "Add Apple calendar" form: subscription link, display name, optional family member, color
  (the existing color palette used for members and categories).
- Each connected subscription shows: name, color swatch, associated person, "Read only" status,
  when it last refreshed, a "Refresh now" button, and "Remove".
- The link itself is never shown again after saving — only a masked hint (e.g. `p123-caldav.icloud.com/…`).
- Removing asks for confirmation: "This will remove all events imported from this Apple calendar
  from Our Family Calendar. Nothing will be deleted from Apple Calendar." On confirm, only that
  subscription's imported events are deleted, plus the subscription record.

## How the events behave

- Appear in Month, Week, 3-Day, Day and Today exactly like other events, drawn in the color chosen
  for that subscription, with the associated person's badge when one was chosen.
- Opening one shows the details with a clear banner: "Synced from Apple Calendar · Read only —
  make changes in Apple Calendar."
- No editing, no dragging/resizing, no deleting individual entries — enforced both in the interface
  and on the server, so a stale page cannot bypass it.
- Timed events, all-day events and repeating events are all supported.

## Refresh behavior

- Each refresh matches events by their Apple identifier (ICS `UID`, plus the occurrence identifier
  for single changed occurrences), so refreshes update in place instead of duplicating.
- Events that changed in Apple are updated; events that no longer exist in the feed are removed.
- Runs automatically on the same scheduled background job pattern already used for Google
  reconciliation (every 30 minutes), and immediately when a subscription is added or refreshed by hand.
- Imports a window of the previous 30 days through the next 12 months.

## Technical outline

**Database (one migration)**
- `calendar_provider` enum gains `ics`.
- `calendar_sources` gains `color text`, `subscription_member_id uuid references family_members(id)`,
  reusing existing `last_synced_at`, `sync_status`, `sync_error` columns. `provider = 'ics'` marks a
  source read-only.
- New `ics_subscription_secrets(source_id pk → calendar_sources, url_ciphertext, url_hint, timestamps)`
  with RLS on and **no** policies — service role only, same shape as `google_connection_secrets`.
  URL encrypted with the existing `crypto.server.ts` helpers; never returned to the client, never logged
  in full.
- Grants for `calendar_sources` changes stay as they are (household-scoped policies already exist).

**Server**
- `src/lib/ics/parse.ts` — small dependency-free ICS parser (line unfolding, `VEVENT`, `UID`,
  `SUMMARY`, `LOCATION`, `DESCRIPTION`, `DTSTART`/`DTEND`/`DURATION`, `VALUE=DATE` all-day, `TZID`
  resolution via the existing timezone helper, `RRULE`, `EXDATE`, `RECURRENCE-ID`, `STATUS:CANCELLED`),
  with focused unit tests.
- `src/lib/ics/import.server.ts` — fetch feed (`webcal://` normalized to `https://`, size/time limits),
  map to the existing event shape, then upsert/update/delete within the window scoped by
  `family_id` + `calendar_source_id` + `external_event_id`.
- `src/lib/ics.functions.ts` — `listIcsSubscriptions`, `addIcsSubscription`, `refreshIcsSubscription`,
  `removeIcsSubscription`, all behind `requireSupabaseAuth` and the existing owner/editor household check.
- `src/routes/api/public/ics/refresh.ts` — scheduled refresh via `runScheduledJob`, plus a pg_cron
  entry every 30 minutes.
- `updateEventFn` / `deleteEventFn` reject events whose source is an `ics` subscription.

**Client**
- `CalendarEvent` gains `read_only` and `source_color`, resolved from the source the same way
  `display_mode` already is in `calendar-ops.ts`.
- `event-colors.ts` uses the subscription color when present; category logic otherwise unchanged.
- `EventDetailsDialog` shows the read-only banner and hides Edit/Delete/Copy; drag/resize hooks skip
  read-only occurrences.
- New `src/components/AppleCalendarSubscriptions.tsx` rendered inside `CalendarSyncSettings`.

**Out of scope:** EventKit, app → Apple writes, two-way editing, conflict resolution.

## Verification

- Focused unit tests for the ICS parser and the import diff (create / update / delete / no duplicates).
- Add a real subscription in the preview, confirm events render in the chosen color, open one to see
  the read-only banner, confirm editing/dragging is blocked, then remove it and confirm only those
  events disappear.
- Build and type check clean. No broad regression run.
