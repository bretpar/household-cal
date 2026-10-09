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
- Babysitter-profile logins receive only caregiver_shifts summaries (their own assigned Babysitter shifts plus related events from permitted calendars on those days); other summary modes stay excluded in dispatch.server.ts. Why: only the shift mode can respect caregiver calendar/date limits; fail closed.
- Timesheet emails are claimed in timesheet_notifications (unique family/kind/version/recipient) before sending; ready/reminder run from the hourly /api/public/timesheets/notify job, submit/review/opt-out send inline from server functions. Why: idempotent, never client-triggered.
- Timesheet availability is decided only by hasFeature("timesheets") in src/lib/features.ts (client surfaces) and assertOwner/myCaregiver in timesheets.server.ts (server). Why: one place for a future paid-plan mapping; data is never deleted when off.
- Owner timesheet review lives in Activities (?tab=timesheets&timesheet=id); Family settings keeps only pay-period and notification config. Why: review is a recurring task, settings are configuration.
- Shift assignment and Timesheet eligibility key on family_members.id (assignee_member_id, families.default_babysitter_member_id, family_members.timesheets_enabled); family_user_id on a shift is only a mirror for limited-view date unlocks. Why: caregivers can be scheduled and paid without a sign-in.
- Owner-managed time cards (timesheets.owner_managed) exist only for Timesheet-enabled caregivers with no household login; Owners edit and approve them directly, no emails. Why: sign-in caregivers keep the certified submit/review flow.
- Timesheet status "closed" (Owner-only closeTimesheet) is read-only history and excluded from every actionable query; family_members.timesheet_start_date (NULL = no limit) filters shifts and actionable periods. Why: retire obsolete periods without deleting data.
- Day, 3-Day, and Week timed cards use the shared header-collision layout in calendar-layout.ts for both background and foreground events; stack priority follows deterministic occurrence order across header groups within each body-overlap cluster. Why: protect later headers without changing true event times or narrowing whole overlap groups.
- Agent integrations (MCP) live in src/lib/mcp/ (read-only tools, Supabase OAuth, RLS as caller). Why: assistants act as the signed-in user.
- App tours live in the authenticated provider, enter Today once, and highlight real bottom tabs through scoped CSS without geometry tracking; versioned state stays per verified user in app_tour_states. Why: fixed walkthroughs avoid route/loading/positioning races while retaining existing eligibility and persistence.

- The public comparison guide renders desktop rows and mobile feature lists from the same comparison data. Why: keep both presentations consistent without horizontal scrolling on phones.
- Desktop/tablet Calendar Day renders only WeekView, which fills the calendar surface; the agenda list stays on Today only. Why: the embedded agenda strip squeezed the hourly timeline and duplicated Today's schedule.
