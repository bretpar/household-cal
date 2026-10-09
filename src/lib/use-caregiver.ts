import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getVerifiedMembership } from "@/lib/auth-guard";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";

export const IS_CAREGIVER_KEY = ["is-caregiver"] as const;

/**
 * Whether the signed-in user is a designated caregiver (babysitter access
 * profile) in the current household. Reads the existing is_babysitter()
 * database helper; access itself is still enforced by RLS.
 */
export function useCaregiver(): { isCaregiver: boolean; resolved: boolean } {
  const { family } = useCalendar();
  // Before the calendar bundle arrives, use the membership the startup guard
  // already verified so navigation can be decided without waiting on events.
  const verified = family ? null : getVerifiedMembership();
  const familyId = family?.id ?? verified?.family_id ?? null;
  const viewer = (family?.role ?? verified?.role) === "viewer";
  const q = useQuery({
    queryKey: [...IS_CAREGIVER_KEY, familyId],
    // Polled for every member so role/access changes reach open sessions (~30s).
    enabled: !!familyId,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_babysitter", { _family_id: familyId! });
      if (error) throw error;
      return data === true;
    },
  });
  const qc = useQueryClient();
  const last = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (q.data === undefined) return;
    if (last.current !== undefined && last.current !== q.data) {
      // Access changed: refresh role, tabs and visible calendar data now.
      void qc.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    }
    last.current = q.data;
  }, [q.data, qc]);
  if (!familyId) return { isCaregiver: false, resolved: false };
  if (!viewer) return { isCaregiver: false, resolved: true };
  // Keep the last known answer during refetches; only a first load is unresolved.
  return { isCaregiver: q.data === true, resolved: q.data !== undefined || q.isError };
}
