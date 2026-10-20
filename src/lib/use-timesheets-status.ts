import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { getTimesheetsStatus } from "@/lib/timesheets.functions";

export const TIMESHEETS_STATUS_KEY = ["timesheets-status"] as const;

/**
 * Household Timesheets switch (server-authoritative) plus whether the caller
 * has past time cards. `active` = full workflow; `history` = read-only access.
 */
export function useTimesheetsStatus() {
  const { family } = useCalendar();
  const fetch = useServerFn(getTimesheetsStatus);
  const entitled = hasFeature("timesheets", { familyId: family?.id });
  const { data, isSuccess } = useQuery({
    queryKey: [...TIMESHEETS_STATUS_KEY, family?.id ?? null],
    queryFn: () => fetch(),
    enabled: entitled && !!family?.id,
    staleTime: 60_000,
  });
  const active = entitled && data?.enabled === true;
  return {
    loaded: isSuccess,
    active,
    history: entitled && !active && data?.has_history === true,
  };
}
