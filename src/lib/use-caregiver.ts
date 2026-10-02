import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCalendar } from "@/lib/calendar-store";

export const IS_CAREGIVER_KEY = ["is-caregiver"] as const;

/**
 * Whether the signed-in user is a designated caregiver (babysitter access
 * profile) in the current household. Reads the existing is_babysitter()
 * database helper; access itself is still enforced by RLS.
 */
export function useCaregiver(): { isCaregiver: boolean; resolved: boolean } {
  const { family } = useCalendar();
  const familyId = family?.id ?? null;
  const viewer = family?.role === "viewer";
  const q = useQuery({
    queryKey: [...IS_CAREGIVER_KEY, familyId],
    enabled: !!familyId && viewer,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_babysitter", { _family_id: familyId! });
      if (error) throw error;
      return data === true;
    },
  });
  if (!familyId) return { isCaregiver: false, resolved: false };
  if (!viewer) return { isCaregiver: false, resolved: true };
  // Keep the last known answer during refetches; only a first load is unresolved.
  return { isCaregiver: q.data === true, resolved: q.data !== undefined || q.isError };
}
