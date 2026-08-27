import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 450;
/** Finger drift allowed before we treat the gesture as a scroll instead. */
const MOVE_TOLERANCE_PX = 12;

export interface LongPressInfo {
  /** pointer position relative to the pressed element */
  offsetX: number;
  offsetY: number;
}

/**
 * Touch/pen long press on empty calendar space.
 *
 * Mouse pointers are ignored so desktop click/drag behavior is untouched.
 * `shouldIgnore` lets callers skip presses that started on an existing event,
 * keeping tap-to-open and drag-to-reschedule intact.
 */
export function useLongPress(
  onLongPress: ((info: LongPressInfo) => void) | undefined,
  options: { shouldIgnore?: (target: EventTarget | null) => boolean } = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const { shouldIgnore } = options;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!onLongPress) return;
      if (event.pointerType === "mouse") return;
      if (shouldIgnore?.(event.target)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      origin.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;
        fired.current = true;
        // Subtle tactile acknowledgement where the platform supports it.
        navigator.vibrate?.(12);
        onLongPress({ offsetX, offsetY });
      }, HOLD_MS);
    },
    [onLongPress, shouldIgnore, clear],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const from = origin.current;
      if (!from || !timer.current) return;
      if (
        Math.abs(event.clientX - from.x) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientY - from.y) > MOVE_TOLERANCE_PX
      ) {
        clear();
      }
    },
    [clear],
  );

  /** Swallow the tap that ends a recognized long press. */
  const onClickCapture = useCallback((event: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!fired.current) return;
    fired.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  if (!onLongPress) return {};

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClickCapture,
  };
}

