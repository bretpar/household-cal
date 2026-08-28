import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { Occurrence } from "@/lib/family-data";

const HOLD_MS = 400;
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
 * an existing event lifts that occurrence keeping its duration. Dragging moves the
 * preview in snap increments and releasing hands the proposed time to the caller,
 * which opens the normal add/edit form — nothing is persisted here.
 *
 * Mouse pointers are ignored so the existing desktop drag-and-drop stays intact.
 * Resize handles can later reuse the same ghost state by varying `durationMinutes`.
 */
export function useTimeGridDrag({
  enabled,
  hourPx,
  dayStartHour,
  dayEndHour,
  snapMinutes = DEFAULT_SNAP_MINUTES,
  createMinutes = DEFAULT_CREATE_MINUTES,
  resolveOccurrence,
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
  const dragOrigin = useRef<{ clientY: number; startMinutes: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const setGhostState = (next: TimeGridGhost | null) => {
    ghostRef.current = next;
    setGhost(next);
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

  const reset = useCallback(() => {
    clearTimer();
    press.current = null;
    dragOrigin.current = null;
    setGhostState(null);
  }, []);

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
      const captureTarget = event.currentTarget;
      const pointerId = event.pointerId;
      clearTimer();

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
        dragOrigin.current = { clientY: start.clientY, startMinutes };
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
      }, HOLD_MS);
    },
    [enabled, resolveOccurrence, snap, snapMinutes, createMinutes, dayStartHour, hourPx],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = ghostRef.current;
      const origin = dragOrigin.current;
      if (active && origin) {
        // Dragging: the grid sets touch-action none, so no scroll competes here.
        const deltaMinutes = ((event.clientY - origin.clientY) / hourPx) * 60;
        const next = snap(origin.startMinutes + deltaMinutes, active.durationMinutes);
        if (next !== active.startMinutes) {
          setGhostState({ ...active, startMinutes: next });
          vibrate(5);
        }
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
    [hourPx, snap],
  );

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

  /** Swallow the tap that ends a recognized long press. */
  const onClickCapture = useCallback((event: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!fired.current) return;
    fired.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  /** Handlers for one day column. */
  const columnProps = useCallback(
    (day: Date) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(day, event),
      onPointerMove,
      onPointerUp: commit,
      onPointerCancel: reset,
      onClickCapture,
    }),
    [onPointerDown, onPointerMove, commit, reset, onClickCapture],
  );

  return { ghost, columnProps, dragging: ghost !== null };
}
