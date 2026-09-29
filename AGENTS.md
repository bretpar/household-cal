<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- calendar_sources.calendar_kind (household_default | custom | legacy_internal) distinguishes the Family calendar, user-created OFC calendars and hidden legacy local rows; event destinations are validated server-side via assertWritableDestination. Why: never rely on calendar names.
- CalendarAppearanceSettings owns the routine My Calendars hub and composes existing provider-management controls; protected diagnostics remain in GoogleCalendarMaintenance. Why: Settings has one calendar-management destination without duplicating provider logic.
- Startup is cream everywhere (html, theme-color, manifest, splash overlay, Capacitor, LaunchScreen) and never recolors the document; the heart mask reveals the calendar. Why: blue page-level overrides caused bands and flicker in Safari, Home Screen and native.
- Babysitter access is a profile on top of Viewer (babysitter_access_profiles); RLS helpers can_read_event/can_read_calendar_source enforce it. Why: role enum and non-babysitter behavior stay unchanged.
- Babysitting shifts: families.babysitter_calendar_source_id marks the Babysitter calendar; babysitter_shifts (one row per event, assignment caregiver|other|none) is synced by syncShiftAssignment on every event save. Why: owner-chosen calendar, never names; only caregiver rows unlock dates.
- Shift-days-only caregivers never read recurring masters (can_read_event denies them); getFamilyBundle adds sanitized per-date occurrences from caregiver-occurrences.server.ts and fails closed. Why: masters leaked unauthorized dates.
- Babysitters (any babysitter access profile) are excluded from summary email sends and previews in dispatch.server.ts. Why: summaries can't yet apply caregiver calendar/date limits; fail closed.
