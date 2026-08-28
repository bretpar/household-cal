import { useRef, type TouchEvent as ReactTouchEvent } from "react";

const MIN_DISTANCE = 60; // px of horizontal travel required
const MAX_VERTICAL_RATIO = 0.6; // vertical travel must stay well under horizontal
const MAX_DURATION = 800; // ms — longer holds are drags, not swipes

/**
 * Native-feeling horizontal swipe navigation for the calendar surfaces.
 *
 * Only reacts to single-finger touch gestures that are clearly horizontal, so
 * vertical scrolling, taps, long-presses and event drags are left untouched.
 */
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
}: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = (e: ReactTouchEvent) => {
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
    if (e.touches.length > 1) start.current = null;
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    const origin = start.current;
    start.current = null;
    if (!origin) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    if (Date.now() - origin.t > MAX_DURATION) return;
    if (Math.abs(dx) < MIN_DISTANCE) return;
    if (Math.abs(dy) > Math.abs(dx) * MAX_VERTICAL_RATIO) return;
    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  };

  const onTouchCancel = () => {
    start.current = null;
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
