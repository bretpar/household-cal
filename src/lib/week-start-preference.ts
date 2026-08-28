import { useEffect, useState } from "react";

/** date-fns weekStartsOn value: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

const STORAGE_PREFIX = "ofc:week-start";
const DEFAULT_WEEK_START: WeekStart = 1;

function keyFor(scope: string | null | undefined) {
  return scope ? `${STORAGE_PREFIX}:${scope}` : STORAGE_PREFIX;
}

function read(scope: string | null | undefined): WeekStart | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(keyFor(scope));
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

/**
 * Per-user "week starts on" preference, stored in the browser for the
 * signed-in scope. Read after hydration so SSR markup stays stable.
 */
export function useWeekStart(scope: string | null | undefined) {
  const [weekStart, setWeekStart] = useState<WeekStart>(DEFAULT_WEEK_START);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setWeekStart(read(scope) ?? DEFAULT_WEEK_START);
    setReady(true);
  }, [scope]);

  const save = (next: WeekStart) => {
    setWeekStart(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(keyFor(scope), String(next));
    }
  };

  return { weekStart, ready, setWeekStart: save };
}
