import { useRef, type TouchEvent as ReactTouchEvent } from "react";

/** Per-view tuning: denser grids need a more deliberate gesture. */
export type SwipeSensitivity = "day" | "week" | "month";

interface Tuning {
  /** px of horizontal travel required */
  minDistance: number;
  /** px/ms — a slow drag must travel further than a flick */
  minVelocity: number;
  /** vertical travel must stay under horizontal * ratio */
  maxVerticalRatio: number;
  /** px of vertical travel that cancels the gesture outright */
  verticalCancel: number;
}

const TUNING: Record<SwipeSensitivity, Tuning> = {
  // Day view is a single tall column: mostly vertical scrolling, so be strict.
  day: { minDistance: 90, minVelocity: 0.25, maxVerticalRatio: 0.4, verticalCancel: 34 },
  // Week view also scrolls vertically but has clear left/right intent.
  week: { minDistance: 80, minVelocity: 0.22, maxVerticalRatio: 0.45, verticalCancel: 40 },
  // Month view barely scrolls, so a lighter swipe is safe.
  month: { minDistance: 60, minVelocity: 0.15, maxVerticalRatio: 0.55, verticalCancel: 56 },
};

const MAX_DURATION = 800; // ms — longer holds are drags, not swipes

/**
 * Native-feeling horizontal swipe navigation for the calendar surfaces.
 *
 * Only reacts to single-finger touch gestures that are clearly horizontal, so
 * vertical scrolling, taps, long-presses and event drags are left untouched.
 * Direction is locked in during the move: once the finger drifts vertically the
 * gesture is abandoned, so diagonal scrolling never navigates.
 */
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  sensitivity = "month",
}: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  sensitivity?: SwipeSensitivity;
}) {
  const tuning = TUNING[sensitivity];
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axis = useRef<"none" | "horizontal" | "vertical">("none");

  const onTouchStart = (e: ReactTouchEvent) => {
    axis.current = "none";
    if (e.touches.length !== 1) {
      start.current = null;
      return;
    }
    const target = e.target as Element | null;
    // Never hijack gestures that begin on an event or other control.
    if (target?.closest?.("[data-occurrence],button,a,input,textarea,select,[role='dialog']")) {
      start.current = null;
      return;
    }
    const touch = e.touches[0]!;
    start.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (e.touches.length > 1) {
      start.current = null;
      return;
    }
    const origin = start.current;
    const touch = e.touches[0];
    if (!origin || !touch) return;
    const dx = Math.abs(touch.clientX - origin.x);
    const dy = Math.abs(touch.clientY - origin.y);

    // Any meaningful vertical drift cancels the gesture for good.
    if (dy > tuning.verticalCancel || (axis.current !== "horizontal" && dy > 12 && dy > dx)) {
      axis.current = "vertical";
      start.current = null;
      return;
    }
    // Lock the axis as horizontal once intent is unambiguous.
    if (axis.current === "none" && dx > 12 && dx > dy * 1.8) axis.current = "horizontal";
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    const origin = start.current;
    start.current = null;
    const locked = axis.current;
    axis.current = "none";
    if (!origin || locked !== "horizontal") return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    const elapsed = Math.max(Date.now() - origin.t, 1);
    if (elapsed > MAX_DURATION) return;
    if (Math.abs(dx) < tuning.minDistance) return;
    if (Math.abs(dy) > Math.abs(dx) * tuning.maxVerticalRatio) return;
    if (Math.abs(dx) / elapsed < tuning.minVelocity) return;
    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  };

  const onTouchCancel = () => {
    start.current = null;
    axis.current = "none";
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
