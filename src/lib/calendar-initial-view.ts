import type { CalendarViewMode, UserPreferences, WeekStart } from "@/lib/user-preferences.types";

export const PREFERENCES_CACHE_KEY = "ofc:user-preferences";

export const DEFAULT_PREFERENCES: UserPreferences = { weekStart: 1, defaultView: "month" };

function parseWeekStart(value: unknown): WeekStart | null {
  return value === 0 ? 0 : value === 1 ? 1 : null;
}

function parseView(value: unknown): CalendarViewMode | null {
  return value === "day" || value === "week" || value === "month" ? value : null;
}

/**
 * Parse the locally cached preferences payload. Used synchronously on first
 * render so a saved Day view never flashes Month while the backend row loads.
 */
export function parseCachedPreferences(raw: string | null): UserPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const weekStart = parseWeekStart(parsed.weekStart);
    const view = parseView(parsed.defaultView);
    if (weekStart === null && view === null) return null;
    return {
      weekStart: weekStart ?? DEFAULT_PREFERENCES.weekStart,
      defaultView: view ?? DEFAULT_PREFERENCES.defaultView,
    };
  } catch {
    return null;
  }
}

/**
 * The view the Calendar screen must show on its first paint. A saved Week
 * default cannot open on a portrait phone, where only Month and Day exist.
 */
export function resolveInitialCalendarView({
  defaultView,
  isPhoneScreen,
  isLandscape,
  portraitView = "month",
}: {
  defaultView: CalendarViewMode | null | undefined;
  isPhoneScreen: boolean;
  isLandscape: boolean;
  portraitView?: Extract<CalendarViewMode, "month" | "day">;
}): CalendarViewMode {
  if (!defaultView) return portraitView;
  const portraitPhone = isPhoneScreen && !isLandscape;
  if (portraitPhone && defaultView === "week") {
    return defaultView === "week" && portraitView ? portraitView : "month";
  }
  return defaultView;
}
