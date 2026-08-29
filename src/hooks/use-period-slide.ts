import { useCallback, useEffect, useRef, useState } from "react";

export type SlideDirection = 1 | -1;

const DURATION = 260;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drives an iOS-Calendar-style horizontal slide when the calendar moves to the
 * next/previous period. The outgoing period keeps rendering (with its old
 * anchor) while it animates away; the incoming one animates in from the
 * opposite side. Navigation is ignored while a transition is in flight so a
 * fast double swipe/tap can't skip two periods.
 */
export function usePeriodSlide<T>() {
  const [outgoing, setOutgoing] = useState<{ value: T; direction: SlideDirection } | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const navigate = useCallback(
    (from: T, direction: SlideDirection, apply: () => void) => {
      if (busy.current) return;
      apply();
      if (prefersReducedMotion()) return;
      busy.current = true;
      setOutgoing({ value: from, direction });
      timer.current = setTimeout(() => {
        setOutgoing(null);
        busy.current = false;
      }, DURATION);
    },
    [],
  );

  return { outgoing, navigate, animating: outgoing !== null };
}
