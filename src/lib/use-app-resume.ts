import { useEffect, useRef } from "react";

import { isNativeApp } from "@/lib/native-auth";

/**
 * Calls `onResume` when the app returns to the foreground after being hidden
 * for at least `minHiddenMs`. Listens to Capacitor appStateChange (native) and
 * visibilitychange (fallback); both firing together run the callback once.
 */
export function useAppResume(onResume: () => void, minHiddenMs = 60_000) {
  const cb = useRef(onResume);
  cb.current = onResume;

  useEffect(() => {
    let hiddenAt: number | null = null;
    let lastRun = 0;
    const hide = () => {
      if (hiddenAt == null) hiddenAt = Date.now();
    };
    const show = () => {
      const since = hiddenAt;
      hiddenAt = null;
      if (since == null || Date.now() - since < minHiddenMs) return;
      if (Date.now() - lastRun < 2000) return; // dedupe native + browser events
      lastRun = Date.now();
      cb.current();
    };
    const onVis = () => (document.visibilityState === "visible" ? show() : hide());
    document.addEventListener("visibilitychange", onVis);

    let remove: (() => void) | undefined;
    let cancelled = false;
    if (isNativeApp()) {
      void import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => (isActive ? show() : hide())),
        )
        .then((h) => {
          if (cancelled) void h.remove();
          else remove = () => void h.remove();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      remove?.();
    };
  }, [minHiddenMs]);
}
