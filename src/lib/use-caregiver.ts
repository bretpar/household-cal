import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCalendar } from "@/lib/calendar-store";

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
    queryKey: ["is-caregiver", familyId],
    enabled: !!familyId && viewer,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_babysitter", { _family_id: familyId! });
      if (error) throw error;
      return data === true;
    },
  });
  if (!familyId) return { isCaregiver: false, resolved: false };
  if (!viewer) return { isCaregiver: false, resolved: true };
  return { isCaregiver: q.data === true, resolved: q.isSuccess || q.isError };
}
