import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Per-view tuning is retained as part of the public hook API. */
export type SwipeSensitivity = "day" | "week" | "month";

const SETTLE_FALLBACK_MS = 420;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A native, three-page horizontal surface for calendar navigation.
 *
 * Previous/current/next periods stay mounted for the whole interaction. The
 * browser owns touch tracking, momentum, and snapping; the date anchor changes
 * only after the snap has completed. Once React renders the new range, a layout
 * effect silently places the same visible period back in the center page before
 * the browser paints.
 */
export function usePeriodCarousel({
  onCommit,
  sensitivity: _sensitivity = "month",
  onNavigate,
  rebaseKey,
  isBlocked,
}: {
  onCommit: (direction: 1 | -1) => void;
  sensitivity?: SwipeSensitivity;
  onNavigate?: () => void;
  rebaseKey: string | number;
  /** While true (e.g. an event long-press drag), the pager never claims a gesture. */
  isBlocked?: () => boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const pendingRebase = useRef(false);
  const suppressScroll = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);

  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const clearSettleTimer = useCallback(() => {
    if (!settleTimer.current) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const centerWithoutAnimation = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    suppressScroll.current = true;
    node.scrollTo({ left: node.clientWidth, behavior: "auto" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressScroll.current = false;
      });
    });
  }, []);

  const finishSnap = useCallback(() => {
    const node = containerRef.current;
    if (!node || suppressScroll.current || pendingRebase.current) return;
    clearSettleTimer();
    const width = node.clientWidth || 1;
    const page = Math.round(node.scrollLeft / width);
    const direction: 1 | -1 | 0 = page > 1 ? 1 : page < 1 ? -1 : 0;

    if (direction === 0) {
      busyRef.current = false;
      setBusy(false);
      return;
    }

    // Keep showing the snapped neighbouring page until the new anchor has
    // rendered. The layout effect below performs the invisible rebase.
    pendingRebase.current = true;
    navigateRef.current?.();
    commitRef.current(direction);
  }, [clearSettleTimer]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    centerWithoutAnimation();

    const scheduleSettle = () => {
      if (suppressScroll.current || pendingRebase.current) return;
      busyRef.current = true;
      setBusy(true);
      clearSettleTimer();
      settleTimer.current = setTimeout(finishSnap, 110);
    };
    const onScrollEnd = () => finishSnap();

    node.addEventListener("scroll", scheduleSettle, { passive: true });
    node.addEventListener("scrollend", onScrollEnd);
    return () => {
      clearSettleTimer();
      node.removeEventListener("scroll", scheduleSettle);
      node.removeEventListener("scrollend", onScrollEnd);
    };
  }, [centerWithoutAnimation, clearSettleTimer, finishSnap]);

  // The anchor update replaces only off-screen date data. Re-center before
  // paint so the snapped page remains visually identical throughout rebasing.
  useLayoutEffect(() => {
    if (!pendingRebase.current) return;
    centerWithoutAnimation();
    pendingRebase.current = false;
    busyRef.current = false;
    setBusy(false);
  }, [rebaseKey, centerWithoutAnimation]);

  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const commit = useCallback(
    (direction: 1 | -1) => {
      const node = containerRef.current;
      if (!node || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const target = node.clientWidth * (direction === 1 ? 2 : 0);
      node.scrollTo({
        left: target,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      clearSettleTimer();
      settleTimer.current = setTimeout(finishSnap, SETTLE_FALLBACK_MS);
    },
    [clearSettleTimer, finishSnap],
  );

  return { containerRef, busy, commit };
}