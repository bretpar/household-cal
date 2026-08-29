import { useCallback, useEffect, useRef, useState } from "react";

/** Per-view tuning: denser grids need a more deliberate gesture. */
export type SwipeSensitivity = "day" | "week" | "month";

interface Tuning {
  /** fraction of the container width that commits the swipe */
  distanceRatio: number;
  /** px/ms — a quick flick commits even on a short drag */
  flickVelocity: number;
}

const TUNING: Record<SwipeSensitivity, Tuning> = {
  day: { distanceRatio: 0.3, flickVelocity: 0.35 },
  week: { distanceRatio: 0.28, flickVelocity: 0.32 },
  month: { distanceRatio: 0.24, flickVelocity: 0.28 },
};

const DURATION = 280;
const AXIS_THRESHOLD = 10;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Direct-manipulation horizontal paging for the calendar surfaces.
 *
 * The track follows the finger in real time (adjacent periods are already
 * mounted on either side), then snaps to the next/previous period on release
 * when the drag passes a distance or velocity threshold — otherwise it snaps
 * back. Vertical gestures are handed straight back to the timeline so the
 * hourly grid keeps scrolling normally; the axis is locked after a small
 * movement threshold so diagonal gestures stay stable.
 */
export function usePeriodCarousel({
  onCommit,
  sensitivity = "month",
  onNavigate,
}: {
  onCommit: (direction: 1 | -1) => void;
  sensitivity?: SwipeSensitivity;
  onNavigate?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [dragging, setDragging] = useState(false);

  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const tuning = TUNING[sensitivity];
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const width = () => containerRef.current?.clientWidth || 1;

  /** Animate to the neighbouring period, then re-center on the new anchor. */
  const commit = useCallback((direction: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    navigateRef.current?.();
    if (prefersReducedMotion()) {
      commitRef.current(direction);
      busy.current = false;
      return;
    }
    setDragging(false);
    setAnimating(true);
    setOffset(-direction * width());
    timer.current = setTimeout(() => {
      // Applied together: the anchor moves while the track snaps back to
      // center with the transition removed, so nothing visibly jumps.
      setAnimating(false);
      setOffset(0);
      commitRef.current(direction);
      busy.current = false;
    }, DURATION);
  }, []);

  const snapBack = useCallback(() => {
    setDragging(false);
    setAnimating(true);
    setOffset(0);
    timer.current = setTimeout(() => setAnimating(false), DURATION);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let start: { x: number; y: number; t: number } | null = null;
    let axis: "none" | "horizontal" | "vertical" = "none";
    let last = { x: 0, t: 0 };

    const reset = () => {
      start = null;
      axis = "none";
    };

    const onTouchStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1) return reset();
      const target = e.target as Element | null;
      // Never hijack gestures that begin on an event or other control.
      if (
        target?.closest?.("[data-occurrence],button,a,input,textarea,select,[role='dialog']")
      ) {
        return reset();
      }
      const touch = e.touches[0]!;
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
      last = { x: touch.clientX, t: start.t };
      axis = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length > 1) return;
      const touch = e.touches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      if (axis === "none") {
        if (Math.abs(dy) > AXIS_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
          axis = "vertical";
          return;
        }
        if (Math.abs(dx) > AXIS_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          axis = "horizontal";
          setDragging(true);
          setAnimating(false);
        } else {
          return;
        }
      }
      if (axis !== "horizontal") return;

      // Horizontal intent: keep the browser from scrolling and follow the finger.
      if (e.cancelable) e.preventDefault();
      last = { x: touch.clientX, t: Date.now() };
      setOffset(dx);
    };

    const onTouchEnd = () => {
      if (!start) return;
      const origin = start;
      const locked = axis;
      reset();
      if (locked !== "horizontal") {
        setDragging(false);
        return;
      }
      const dx = last.x - origin.x;
      const elapsed = Math.max(last.t - origin.t, 1);
      const velocity = Math.abs(dx) / elapsed;
      const { distanceRatio, flickVelocity } = tuningRef.current;
      const passed =
        Math.abs(dx) > width() * distanceRatio ||
        (velocity > flickVelocity && Math.abs(dx) > 24);
      if (passed) commit(dx < 0 ? 1 : -1);
      else snapBack();
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [commit, snapBack]);

  return {
    containerRef,
    offset,
    dragging,
    animating,
    /** true while a transition is in flight — ignore extra navigation */
    busy: animating,
    commit,
    duration: DURATION,
  };
}
