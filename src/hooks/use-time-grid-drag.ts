import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { Occurrence } from "@/lib/family-data";

const HOLD_MS = 400;
/**
 * Coverage/childcare bands are large touch surfaces where a deliberate tap
 * naturally lingers. Use a longer hold threshold so a quick tap reliably opens
 * the event instead of entering move/drag mode.
 */
const COVERAGE_HOLD_MS = 600;
/** Finger drift allowed before we treat the gesture as a scroll instead. */
const MOVE_TOLERANCE_PX = 12;
const DEFAULT_SNAP_MINUTES = 15;
const DEFAULT_CREATE_MINUTES = 60;

export interface TimeGridGhost {
  /** "create" = new event preview, "move" = lifted existing occurrence */
  kind: "create" | "move";
  /** day column the ghost belongs to */
  day: Date;
  /** minutes from midnight, already snapped */
  startMinutes: number;
  durationMinutes: number;
  occurrence: Occurrence | null;
}

interface Options {
  /** false for viewers: no ghosts, no gestures */
  enabled: boolean;
  hourPx: number;
  dayStartHour: number;
  dayEndHour: number;
  snapMinutes?: number;
  /** duration of a freshly created preview block */
  createMinutes?: number;
  /** maps a `data-occurrence-key` back to its occurrence */
  resolveOccurrence: (key: string) => Occurrence | undefined;
  /** The scrolling timeline, frozen at its current position while dragging. */
  scrollContainerRef?: RefObject<HTMLElement | null> | undefined;
  /** Notifies the calendar shell so it can stand down its own gestures. */
  onDragStateChange?: ((dragging: boolean) => void) | undefined;
  /**
   * Identifies coverage/childcare occurrences whose bands are large touch
   * surfaces. Presses starting on these use a longer hold threshold so quick
   * taps reliably open the event instead of entering move/drag mode.
   */
  isCoverageLayer?: ((occurrence: Occurrence) => boolean) | undefined;
  onCreate: (start: Date, end: Date) => void;
  onMove: (occurrence: Occurrence, start: Date) => void;
}

function vibrate(ms: number) {
  navigator.vibrate?.(ms);
}

/**
 * Touch/pen long-press + vertical drag for a time-grid column.
 *
 * Long-pressing empty space lifts a fixed-duration "create" preview; long-pressing
 * an existing event lifts that occurrence keeping its duration. Once the hold
 * fires we enter a dedicated drag mode: the pointer is captured, native touch
 * scrolling is blocked (so neither the vertical timeline nor the horizontal
 * day/week pager can steal the gesture), and vertical finger movement moves the
 * lifted block. Releasing snaps to the nearest increment and hands the proposed
 * time to the caller.
 *
 * Mouse pointers are ignored so the existing desktop drag-and-drop stays intact.
 */
export function useTimeGridDrag({
  enabled,
  hourPx,
  dayStartHour,
  dayEndHour,
  snapMinutes = DEFAULT_SNAP_MINUTES,
  createMinutes = DEFAULT_CREATE_MINUTES,
  resolveOccurrence,
  scrollContainerRef,
  onDragStateChange,
  isCoverageLayer,
  onCreate,
  onMove,
}: Options) {
  const [ghost, setGhost] = useState<TimeGridGhost | null>(null);
  const ghostRef = useRef<TimeGridGhost | null>(null);
  const press = useRef<{
    day: Date;
    clientY: number;
    clientX: number;
    offsetY: number;
    occurrence: Occurrence | null;
  } | null>(null);
  const dragOrigin = useRef<{
    clientY: number;
    startMinutes: number;
    scrollTop: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const lastClientY = useRef(0);
  const activePointerId = useRef<number | null>(null);
  const scrollLock = useRef<{
    node: HTMLElement;
    top: number;
    overflowY: string;
    overscrollBehaviorY: string;
  } | null>(null);
  const dragStateRef = useRef(onDragStateChange);
  dragStateRef.current = onDragStateChange;

  const setGhostState = (next: TimeGridGhost | null) => {
    const was = ghostRef.current !== null;
    ghostRef.current = next;
    setGhost(next);
    if (was !== (next !== null)) dragStateRef.current?.(next !== null);
  };

  const snap = useCallback(
    (minutes: number, duration: number) => {
      const min = dayStartHour * 60;
      const max = dayEndHour * 60 - duration;
      const clamped = Math.max(min, Math.min(max, minutes));
      return Math.round(clamped / snapMinutes) * snapMinutes;
    },
    [dayStartHour, dayEndHour, snapMinutes],
  );

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /**
   * While drag mode is live we swallow native touch scrolling. Registering a
   * non-passive listener mid-gesture still applies to the remaining moves of
   * the in-flight touch on iOS, which `touch-action` alone does not.
   */
  const blockNativeScroll = useRef<{
    move: (event: TouchEvent) => void;
    end: () => void;
    cancel: () => void;
  } | null>(null);
  const startScrollBlock = () => {
    if (blockNativeScroll.current) return;
    const move = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      const touch = event.touches[0];
      if (touch && ghostRef.current) updatePointerRef.current(touch.clientY);
    };
    const end = () => {
      if (ghostRef.current) commitRef.current();
    };
    const cancel = () => {
      if (ghostRef.current) resetRef.current();
    };
    blockNativeScroll.current = { move, end, cancel };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", cancel);
  };
  const stopScrollBlock = () => {
    const handlers = blockNativeScroll.current;
    if (!handlers) return;
    document.removeEventListener("touchmove", handlers.move);
    document.removeEventListener("touchend", handlers.end);
    document.removeEventListener("touchcancel", handlers.cancel);
    blockNativeScroll.current = null;
  };

  const lockTimelineScroll = () => {
    const node = scrollContainerRef?.current;
    if (!node || scrollLock.current) return;
    scrollLock.current = {
      node,
      top: node.scrollTop,
      overflowY: node.style.overflowY,
      overscrollBehaviorY: node.style.overscrollBehaviorY,
    };
    node.style.setProperty("overflow-y", "hidden", "important");
    node.style.setProperty("overscroll-behavior-y", "none", "important");
  };

  const unlockTimelineScroll = () => {
    const lock = scrollLock.current;
    if (!lock) return;
    lock.node.style.overflowY = lock.overflowY;
    lock.node.style.overscrollBehaviorY = lock.overscrollBehaviorY;
    lock.node.scrollTop = lock.top;
    scrollLock.current = null;
  };

  /** Recompute the ghost start from the last finger position + scroll offset. */
  const updateFromPointer = useCallback(() => {
    const active = ghostRef.current;
    const origin = dragOrigin.current;
    if (!active || !origin) return;
    const deltaPx = lastClientY.current - origin.clientY;
    const next = snap(origin.startMinutes + (deltaPx / hourPx) * 60, active.durationMinutes);
    if (next !== active.startMinutes) {
      setGhostState({ ...active, startMinutes: next });
      vibrate(5);
    }
  }, [hourPx, snap, scrollContainerRef]);

  const resetRef = useRef<() => void>(() => {});
  const reset = useCallback(() => {
    clearTimer();
    stopScrollBlock();
    unlockTimelineScroll();
    activePointerId.current = null;
    press.current = null;
    dragOrigin.current = null;
    setGhostState(null);
  }, []);
  resetRef.current = reset;

  const commitRef = useRef<() => void>(() => {});
  const updatePointerRef = useRef<(clientY: number) => void>(() => {});

  useEffect(() => {
    // Mobile Safari and Chromium can stop dispatching React pointer moves to a
    // pan-y surface after a hold. Document-level pointer tracking keeps the
    // lifted event attached to the finger without disabling normal pre-hold
    // timeline scrolling.
    const onDocumentPointerMove = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId || !ghostRef.current) return;
      if (event.cancelable) event.preventDefault();
      updatePointerRef.current(event.clientY);
    };
    const onWheel = (event: WheelEvent) => {
      if (!ghostRef.current) return;
      event.preventDefault();
    };
    const onDocumentPointerUp = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId || !ghostRef.current) return;
      commitRef.current();
    };
    const onDocumentPointerCancel = (event: PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return;
      // Touch streams can emit pointercancel when the original surface began as
      // pan-y. The non-passive touch stream remains authoritative until the
      // corresponding touchend/touchcancel arrives.
      if (event.pointerType === "touch" && blockNativeScroll.current) return;
      reset();
    };

    document.addEventListener("pointermove", onDocumentPointerMove, { passive: false });
    document.addEventListener("pointerup", onDocumentPointerUp);
    document.addEventListener("pointercancel", onDocumentPointerCancel);
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stopScrollBlock();
      unlockTimelineScroll();
      document.removeEventListener("pointermove", onDocumentPointerMove);
      document.removeEventListener("pointerup", onDocumentPointerUp);
      document.removeEventListener("pointercancel", onDocumentPointerCancel);
      document.removeEventListener("wheel", onWheel);
    };
  }, [reset]);

  const onPointerDown = useCallback(
    (day: Date, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.pointerType === "mouse") return;
      // A fresh press always starts as a potential tap.
      fired.current = false;
      const target = event.target instanceof Element ? event.target : null;
      const holder = target?.closest<HTMLElement>("[data-occurrence-key]");
      const occurrence = holder ? (resolveOccurrence(holder.dataset["occurrenceKey"]!) ?? null) : null;
      const rect = event.currentTarget.getBoundingClientRect();
      press.current = {
        day,
        clientY: event.clientY,
        clientX: event.clientX,
        offsetY: event.clientY - rect.top,
        occurrence,
      };
      lastClientY.current = event.clientY;
      const captureTarget = event.currentTarget;
      const pointerId = event.pointerId;
      clearTimer();
      // Coverage bands are large touch surfaces: require a more deliberate
      // hold before entering move/drag mode so a quick tap opens the event.
      const holdMs =
        occurrence && isCoverageLayer?.(occurrence) ? COVERAGE_HOLD_MS : HOLD_MS;

      timer.current = setTimeout(() => {
        timer.current = null;
        const start = press.current;
        if (!start) return;
        fired.current = true;
        const duration = start.occurrence
          ? Math.max(
              snapMinutes,
              (start.occurrence.end.getTime() - start.occurrence.start.getTime()) / 60000,
            )
          : createMinutes;
        const rawStart = start.occurrence
          ? start.occurrence.start.getHours() * 60 + start.occurrence.start.getMinutes()
          : dayStartHour * 60 + (start.offsetY / hourPx) * 60;
        const startMinutes = snap(rawStart, duration);
        dragOrigin.current = {
          clientY: start.clientY,
          startMinutes,
          scrollTop: scrollContainerRef?.current?.scrollTop ?? 0,
        };
        activePointerId.current = pointerId;
        // Take over the gesture: no vertical timeline scroll, no horizontal pager.
        lockTimelineScroll();
        startScrollBlock();
        setGhostState({
          kind: start.occurrence ? "move" : "create",
          day: start.occurrence ? start.occurrence.start : start.day,
          startMinutes,
          durationMinutes: duration,
          occurrence: start.occurrence,
        });
        // iOS starts a selection/loupe on a held touch; drop it as the drag begins.
        window.getSelection?.()?.removeAllRanges();
        vibrate(14);

        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          /* capture is a nicety; drag still works without it */
        }
      }, holdMs);
    },
    [
      enabled,
      resolveOccurrence,
      snap,
      snapMinutes,
      createMinutes,
      dayStartHour,
      hourPx,
      isCoverageLayer,
      scrollContainerRef,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      lastClientY.current = event.clientY;
      if (ghostRef.current && dragOrigin.current) {
        // Drag mode owns the pointer: move the block, never the calendar.
        event.preventDefault();
        updateFromPointer();
        return;
      }
      const start = press.current;
      if (!start || !timer.current) return;
      if (
        Math.abs(event.clientY - start.clientY) > MOVE_TOLERANCE_PX ||
        Math.abs(event.clientX - start.clientX) > MOVE_TOLERANCE_PX
      ) {
        clearTimer();
        press.current = null;
      }
    },
    [updateFromPointer],
  );

  updatePointerRef.current = (clientY: number) => {
    lastClientY.current = clientY;
    updateFromPointer();
  };

  const commit = useCallback(() => {
    const active = ghostRef.current;
    const start = press.current;
    reset();
    if (!active) return;
    const day = active.kind === "move" && active.occurrence ? active.occurrence.start : (start?.day ?? active.day);
    const startAt = new Date(day);
    startAt.setHours(Math.floor(active.startMinutes / 60), active.startMinutes % 60, 0, 0);
    if (active.kind === "move" && active.occurrence) {
      onMove(active.occurrence, startAt);
      return;
    }
    onCreate(startAt, new Date(startAt.getTime() + active.durationMinutes * 60000));
  }, [onCreate, onMove, reset]);
  commitRef.current = commit;

  /** Swallow the tap that ends a recognized long press. */
  const onClickCapture = useCallback((event: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!fired.current) return;
    fired.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  /** Suppress the native context menu / selection callout the hold would raise. */
  const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
    if (!enabled) return;
    event.preventDefault();
  }, [enabled]);

  /** Handlers for one day column. */
  const columnProps = useCallback(
    (day: Date) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(day, event),
      onPointerMove,
      onPointerUp: commit,
      onPointerCancel: reset,
      onClickCapture,
      onContextMenu,
    }),
    [onPointerDown, onPointerMove, commit, reset, onClickCapture, onContextMenu],
  );


  return { ghost, columnProps, dragging: ghost !== null };
}
