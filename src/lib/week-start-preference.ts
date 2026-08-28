import { useUserPreferences, type WeekStart } from "@/lib/user-preferences";

export type { WeekStart };

/**
 * Per-user "week starts on" preference. Stored in the backend (see
 * user-preferences) so it follows the user across devices; the legacy `scope`
 * argument is accepted for call-site compatibility and ignored.
 */
export function useWeekStart(_scope?: string | null | undefined) {
  const { weekStart, ready, savePreferences } = useUserPreferences();
  return {
    weekStart,
    ready,
    setWeekStart: (next: WeekStart) => {
      void savePreferences({ weekStart: next });
    },
  };
}
