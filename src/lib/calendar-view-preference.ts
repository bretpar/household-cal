import { useUserPreferences, type CalendarViewMode } from "@/lib/user-preferences";

/** Calendar view modes, shared by the Calendar page and the Preferences screen. */
export type { CalendarViewMode };

export const CALENDAR_VIEW_LABEL: Record<CalendarViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

/**
 * Per-user default calendar view, stored in the backend so it follows the user
 * across devices. The legacy `scope` argument is ignored.
 */
export function useDefaultCalendarView(_scope?: string | null | undefined) {
  const { defaultView, ready, savePreferences } = useUserPreferences();
  return {
    defaultView: ready ? defaultView : null,
    ready,
    setDefaultView: (next: CalendarViewMode) => {
      void savePreferences({ defaultView: next });
    },
  };
}
