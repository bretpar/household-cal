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
