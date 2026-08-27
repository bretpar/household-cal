import { useEffect, useState } from "react";

/** Calendar view modes, shared by the Calendar page and the Settings preference. */
export type CalendarViewMode = "month" | "week" | "day";

export const CALENDAR_VIEW_LABEL: Record<CalendarViewMode, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
};

const STORAGE_PREFIX = "ofc:default-calendar-view";

function keyFor(scope: string | null | undefined) {
  return scope ? `${STORAGE_PREFIX}:${scope}` : STORAGE_PREFIX;
}

function read(scope: string | null | undefined): CalendarViewMode | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(keyFor(scope));
  return value === "month" || value === "week" || value === "day" ? value : null;
}

/**
 * Per-user default calendar view, stored in the browser for the signed-in scope.
 * Read after hydration so SSR markup stays stable.
 */
export function useDefaultCalendarView(scope: string | null | undefined) {
  const [defaultView, setDefaultView] = useState<CalendarViewMode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDefaultView(read(scope));
    setReady(true);
  }, [scope]);

  const save = (next: CalendarViewMode) => {
    setDefaultView(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(keyFor(scope), next);
    }
  };

  return { defaultView, ready, setDefaultView: save };
}
