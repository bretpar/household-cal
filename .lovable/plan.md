# Google Calendar Sync V1

Two-way sync between Our Family Calendar and up to 2 Google calendars per household, owner-controlled, with app-owned family assignments preserved.

## What you must do manually (one time)

Google sign-in for the app is already handled. Calendar sync needs its own Google OAuth client so each household owner can connect a *calendar* account:

1. In Google Cloud Console → APIs & Services, enable **Google Calendar API**.
2. Create an **OAuth 2.0 Web application** client.
3. Add the redirect URI Lovable shows when I open the App User Connector setup card.
4. Paste the client ID/secret into that card.

I'll open that card during implementation; nothing else on your side.

Scopes requested (minimum needed):
- `https://www.googleapis.com/auth/calendar` (read calendars, create calendars, create/update/delete events, watch channels)
- `userinfo.email` (to show which Google account is connected)

## Database changes

- `google_connections` (exists) — extend with: `google_account_id`, `status` (connected/disconnected/error), `last_error`, `last_synced_at`. Tokens are stored encrypted server-side only, never sent to the browser.
- `calendar_sources` (exists) — add `is_main`, `google_sync_token`, `google_channel_id`, `google_channel_expires_at`. Limit of 2 Google sources per household enforced by a trigger.
- New `event_sync_links` — maps one app event (and optional recurrence branch) to one Google event: `event_id`, `calendar_source_id`, `google_event_id`, `google_recurring_event_id`, `branch_key`, `google_etag`, `google_updated_at`, `app_version`, `last_source` (`app` | `google`), `deleted_at`.
- `events` — add `needs_family_assignment` boolean for Google-created events.

All new tables get GRANTs + household-scoped RLS matching the existing `has_family_access` / `is_family_owner` helpers. Sync writes run through service-role server code, not the client.

## Sync architecture

- **Owner connect flow**: `Settings → Calendar Sync` starts the App User Connector consent popup, stores the encrypted connection key against the household, and lists the Google calendars.
- **App → Google**: after any create/update/delete of an event, a server function pushes the change to the linked Google calendar and records `google_etag` / `google_updated_at` with `last_source = 'app'`.
- **Google → App**: a public webhook route `/api/public/google-calendar/notify` receives Google push notifications, then runs an incremental `events.list` using the stored sync token per calendar and applies changes.
- **Reconciliation**: a scheduled `/api/public/google-calendar/reconcile` endpoint (secret-protected, driven by pg_cron) re-lists the sync window, repairs missed creates/updates/deletes, and refreshes expiring watch channels.
- **Sync window**: first import −3/+3 months; ongoing pushes and reconciliation cover +3 months forward. Already-linked older events still accept incoming updates/deletes.

## Recurrence and branch mapping

- One app recurring event with uniform members → one Google recurring series.
- Multi-person weekday branches (School: Mon = B, Tue–Thu = B & E) → one Google series per branch, each row in `event_sync_links` carrying the same `event_id` plus a distinct `branch_key` (the weekday set) and title `School - B` / `School - B & E`.
- Single-occurrence external edits map to Google instance exceptions → app `excluded_dates` + a detached one-off event, same as the app's existing "this event only" behavior.
- "This and future" maps to Google series split; whole-series edits/deletes apply to every branch only when the whole logical series changed.

## Conflict resolution

- Every link row keeps `google_updated_at` and an app-side version bump.
- Incoming Google change is applied only when its `updated` timestamp is newer than the app's last local change; otherwise it's ignored and the app value is re-pushed.
- Loop prevention: after an app-initiated push, the returned Google `etag`/`updated` are stored, so the echo notification is recognized as self-authored and skipped.
- Google only writes Google-compatible fields (title, times, all-day, location, description, recurrence, cancellation). Member assignments, access rules, branch logic and app metadata are never inferred from Google titles.

## UI

- `Settings → Calendar Sync` (owner-only, hidden for editors/viewers): connection status with Reconnect, Calendar 1 / Calendar 2 slots with Create new / Select existing / Rename / Disconnect / Replace, Main Calendar radio, and `Last synced`.
- Event form: Google calendar selector appears only when 2 calendars are connected.
- Google-imported events get a subtle **Needs family assignment** badge that disappears once a member is assigned.
- If disconnected, the app keeps working and local events are untouched; a banner offers Reconnect and sync resumes after reconnect.

## Testing

Automated tests against the existing QA accounts (Dad = owner, Mom = editor, Babysitter = viewer) plus unit tests for the mapping layer: owner-only access, viewer denial, calendar creation/selection, main-calendar routing, app→Google, Google→app create/edit/delete, cross-calendar move, needs-assignment badge lifecycle, member data surviving external edits, single-occurrence and whole-series recurrence, branch-specific edits, duplicate/loop prevention, disconnect/reconnect resilience, ±3-month import, and household isolation/RLS.

## Delivery order

1. Migration + connector client setup.
2. Server sync core (mapping, push, pull, reconcile) with unit tests.
3. Settings → Calendar Sync UI and event-form calendar selector.
4. Badge + disconnected states.
5. End-to-end QA pass and final report.
