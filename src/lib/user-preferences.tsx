import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

/** date-fns weekStartsOn value: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;
export type CalendarViewMode = "month" | "week" | "day";

export interface UserPreferences {
  weekStart: WeekStart;
  defaultView: CalendarViewMode;
}

export const DEFAULT_PREFERENCES: UserPreferences = { weekStart: 1, defaultView: "month" };

const CACHE_KEY = "ofc:user-preferences";

function readCache(): UserPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const weekStart = parsed.weekStart === 0 ? 0 : parsed.weekStart === 1 ? 1 : null;
    const view =
      parsed.defaultView === "day" || parsed.defaultView === "week" || parsed.defaultView === "month"
        ? parsed.defaultView
        : null;
    if (weekStart === null && view === null) return null;
    return {
      weekStart: weekStart ?? DEFAULT_PREFERENCES.weekStart,
      defaultView: view ?? DEFAULT_PREFERENCES.defaultView,
    };
  } catch {
    return null;
  }
}

function writeCache(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — the backend row is still the source of truth */
  }
}

interface PreferencesContextValue extends UserPreferences {
  ready: boolean;
  savePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * Per-user display preferences stored in the backend so they follow the user
 * across devices. The last known values are cached locally purely to avoid a
 * flash of defaults before the first fetch resolves.
 */
export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    if (cached) setPrefs(cached);

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data } = await supabase
        .from("user_preferences")
        .select("week_start, default_calendar_view")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const next: UserPreferences = {
          weekStart: data.week_start === 0 ? 0 : 1,
          defaultView: (data.default_calendar_view as CalendarViewMode) ?? "month",
        };
        setPrefs(next);
        writeCache(next);
      }
      setReady(true);
    })().catch(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const savePreferences = useCallback(
    async (patch: Partial<UserPreferences>) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      writeCache(next);
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return;
      await supabase.from("user_preferences").upsert(
        {
          user_id: userId,
          week_start: next.weekStart,
          default_calendar_view: next.defaultView,
        },
        { onConflict: "user_id" },
      );
    },
    [prefs],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ ...prefs, ready, savePreferences }),
    [prefs, ready, savePreferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useUserPreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (ctx) return ctx;
  // Public routes render outside the provider; fall back to defaults.
  return {
    ...DEFAULT_PREFERENCES,
    ready: false,
    savePreferences: async () => {},
  };
}
