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
- calendar_sources.calendar_kind (household_default | custom | legacy_internal) distinguishes the Family calendar, user-created OFC calendars and hidden legacy rows; destinations are validated server-side via assertWritableDestination. Why: never rely on calendar names.
- CalendarAppearanceSettings owns the My Calendars hub and composes provider-management controls; protected diagnostics stay in GoogleCalendarMaintenance. Why: one calendar-management destination without duplicating provider logic.
- Startup is cream everywhere (html, theme-color, manifest, splash, Capacitor, LaunchScreen, SceneDelegate WebView surfaces) and never recolors the document; the heart mask reveals the calendar. Why: blue overrides caused bands and first-paint flashes.
- Babysitter access is a profile on top of Viewer (babysitter_access_profiles); RLS helpers can_read_event/can_read_calendar_source enforce it. Why: role enum and non-babysitter behavior stay unchanged.
- Babysitting shifts: families.babysitter_calendar_source_id marks the Babysitter calendar; babysitter_shifts (one row per event, assignment caregiver|other|none) is synced by syncShiftAssignment on every save. Why: owner-chosen calendar, never names; only caregiver rows unlock dates.
- Shared Add/Edit Event fields and validation use the household Babysitter calendar id; preserve hidden values in state but submit caregiver assignments only to that destination. Why: switching calendars must not erase values or attach a hidden caregiver.
- Shift-days-only caregivers never read recurring masters (can_read_event denies them); getFamilyBundle adds sanitized per-date occurrences from caregiver-occurrences.server.ts and fails closed. Why: masters leaked unauthorized dates.
- Babysitter-profile logins receive only caregiver_shifts summaries (own assigned shifts plus related events from permitted calendars on those days); other modes stay excluded in dispatch.server.ts. Why: only the shift mode respects caregiver limits; fail closed.
- Timesheet emails are claimed in timesheet_notifications (unique family/kind/version/recipient) before sending; ready/reminder run from the hourly /api/public/timesheets/notify job, others send inline. Why: idempotent, never client-triggered.
- Timesheet availability is decided only by hasFeature("timesheets") in src/lib/features.ts (client) and assertOwner/myCaregiver in timesheets.server.ts (server). Why: one place for a future paid-plan mapping; data is never deleted when off.
- Owner timesheet review lives in Activities (?tab=timesheets&timesheet=id); Family settings keeps only pay-period and notification config. Why: review is a task, settings are configuration.
- Shift assignment and Timesheet eligibility key on family_members.id (assignee_member_id, default_babysitter_member_id, timesheets_enabled); family_user_id on a shift only mirrors limited-view date unlocks. Why: caregivers can be scheduled and paid without a sign-in.
- Owner-managed time cards (timesheets.owner_managed) exist only for Timesheet-enabled caregivers with no household login; Owners edit and approve them directly, no emails. Why: sign-in caregivers keep the certified submit/review flow.
- Timesheet status "closed" (Owner-only closeTimesheet) is read-only history excluded from actionable queries; family_members.timesheet_start_date (NULL = no limit) filters shifts and periods. Why: retire obsolete periods without deleting data.
- Day, 3-Day, and Week timed cards use the shared header-collision layout in calendar-layout.ts; stack priority follows deterministic occurrence order within each body-overlap cluster. Why: protect later headers without changing true event times.
- Agent integrations (MCP) live in src/lib/mcp/ (read-only, Supabase OAuth, RLS as caller). Why: assistants act as the signed-in user.
- App tours live in the authenticated provider, enter Today once, and highlight real bottom tabs through scoped CSS; versioned state stays per verified user in app_tour_states. Why: fixed walkthroughs avoid route/loading/positioning races.
- The public comparison guide renders desktop rows and mobile feature lists from the same data. Why: no horizontal scrolling on phones.
- Desktop/tablet Calendar Day renders only WeekView, filling the calendar surface; the agenda list stays on Today. Why: the embedded strip squeezed the timeline.
- Calendar events load in bounded date windows: views report their range via setVisibleRange, the bundle query is keyed by it, and the server returns overlapping one-offs plus all recurring masters. Why: the app no longer downloads the entire event history on launch.
- Persisted Today-window event cache (src/lib/event-cache.ts): scoped to verified user+household+role, written only when scope unchanged after fetch, cleared on sign-out/account switch. Why: instant reopen without leaking events across accounts or permissions.
- Mobile Day/3-Day uses native horizontal scrolling, gutter-aware CSS snapping and settled-position date commits. Why: Safari owns direction locking and momentum.
