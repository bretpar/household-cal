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
  /** While a finger drag owns the horizontal axis, scroll-settle must not run. */
  const draggingX = useRef(false);
  /** Last finger-following scroll position, for engines that defer the write. */
  const lastIntended = useRef<number | null>(null);
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
      if (suppressScroll.current || pendingRebase.current || draggingX.current) return;
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

  // Touch-axis arbitration. The Day/3-Day timeline inside the track scrolls
  // vertically (touch-action: pan-y), which disables native horizontal panning
  // for gestures that start on it — so horizontal drags never reach this
  // carousel natively. We claim horizontal intent in JS and drive scrollLeft
  // with the finger; vertical intent is left untouched for native scrolling.
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const AXIS_THRESHOLD = 10;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let axis: "undecided" | "x" | "y" = "undecided";
    let active = false;

    const restoreSnap = () => {
      node.style.scrollSnapType = "";
    };

    // While any dialog/sheet/menu is open, the pager never claims a gesture.
    // Listeners live only on this scroll node (never window/document), so
    // events inside portaled overlays never reach them — this guard covers
    // gestures that land on the calendar surface itself.
    const overlayOpen = () =>
      !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );

    // iOS Safari ignores programmatic scrollLeft writes while a touch gesture
    // is active, so the track would stay pinned until release. We still write
    // scrollLeft (Chromium honors it and it drives the settle math), then
    // compensate any shortfall with a transform on the page children so the
    // visible content tracks the finger 1:1 on every engine.
    const clearDragShift = () => {
      lastIntended.current = null;
      for (const child of Array.from(node.children) as HTMLElement[]) {
        if (child.style.transform) child.style.transform = "";
      }
    };

    const applyIntended = (intended: number) => {
      const max = Math.max(0, node.scrollWidth - node.clientWidth);
      const clamped = Math.max(0, Math.min(max, intended));
      lastIntended.current = clamped;
      node.scrollLeft = clamped;
      // Compensate whatever the engine refused to apply (Safari mid-gesture).
      const shift = node.scrollLeft - clamped;
      for (const child of Array.from(node.children) as HTMLElement[]) {
        child.style.transform = shift ? `translate3d(${shift}px, 0, 0)` : "";
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || isBlockedRef.current?.() || overlayOpen()) {
        active = false;
        axis = "undecided";
        return;
      }
      active = true;
      axis = "undecided";
      startX = touch.clientX;
      startY = touch.clientY;
      startScrollLeft = node.scrollLeft;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      // A long-press event drag may activate mid-gesture; hand control over.
      if (isBlockedRef.current?.()) {
        active = false;
        axis = "undecided";
        draggingX.current = false;
        clearDragShift();
        restoreSnap();
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (axis === "undecided") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "x") {
          node.style.scrollSnapType = "none";
          draggingX.current = true;
          busyRef.current = true;
          setBusy(true);
        }
      }
      if (axis !== "x") return;
      // Stop the native vertical timeline scroll; we own this gesture now.
      if (e.cancelable) e.preventDefault();
      // Immediate 1:1 movement with the finger; animation only on release.
      applyIntended(startScrollLeft - dx);
    };

    const settleToNearestPage = () => {
      const width = node.clientWidth || 1;
      const page = Math.round(node.scrollLeft / width);
      const target = Math.max(0, Math.min(2, page)) * width;
      node.scrollTo({
        left: target,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      clearSettleTimer();
      settleTimer.current = setTimeout(finishSnap, SETTLE_FALLBACK_MS);
    };

    const onTouchEnd = () => {
      if (!active || axis !== "x") {
        active = false;
        axis = "undecided";
        return;
      }
      active = false;
      axis = "undecided";
      draggingX.current = false;
      // Land exactly where the finger left the track (touch-end writes are
      // honored even on iOS), then clear the visual compensation in the same
      // frame so there is no flicker.
      if (lastIntended.current != null) node.scrollLeft = lastIntended.current;
      clearDragShift();
      restoreSnap();
      // Settle to the nearest period boundary; the scroll/scrollend handlers
      // above commit the anchor once the snap animation has finished.
      settleToNearestPage();
    };

    // Desktop trackpads: horizontal wheel over the grid pans the calendar.
    // Consuming the gesture (preventDefault) also blocks the browser's
    // swipe-between-history-pages navigation. Events outside this node never
    // reach this listener.
    let wheelSettle: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (isBlockedRef.current?.() || overlayOpen()) return;
      const unit = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 1) return;
      e.preventDefault();
      if (node.style.scrollSnapType !== "none") node.style.scrollSnapType = "none";
      busyRef.current = true;
      setBusy(true);
      const max = Math.max(0, node.scrollWidth - node.clientWidth);
      node.scrollLeft = Math.max(0, Math.min(max, node.scrollLeft + dx));
      if (wheelSettle) clearTimeout(wheelSettle);
      wheelSettle = setTimeout(() => {
        wheelSettle = null;
        restoreSnap();
        settleToNearestPage();
      }, 140);
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (wheelSettle) clearTimeout(wheelSettle);
      draggingX.current = false;
      clearDragShift();
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      node.removeEventListener("wheel", onWheel);
    };
  }, [clearSettleTimer, finishSnap]);

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