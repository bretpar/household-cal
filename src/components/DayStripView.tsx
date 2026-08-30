import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import { WeekView } from "@/components/WeekView";
import { useDayStrip } from "@/hooks/use-day-strip";
import type { CalendarEvent, MemberId } from "@/lib/family-data";

/** Days kept mounted on each side of the visible range. */
const BUFFER = 14;
/** How close to the mounted edge we may drift before rebasing (after settle). */
const EDGE = 4;
/** Width of the hour gutter inside WeekView (3.25rem). */
const GUTTER_PX = 52;

/**
 * Mobile Day / 3-Day calendar: one continuous strip of single-day columns.
 *
 * The mounted day window stays fixed during a gesture, so dragging moves every
 * column, its time grid and its events together with the finger. Releasing eases
 * into the nearest single day column and only then updates the anchor (and, if
 * needed, silently rebases the mounted window with the scroll position
 * compensated so nothing moves on screen).
 */
export function DayStripView({
  anchor,
  onAnchorChange,
  visibleDays,
  events,
  selectedMembers,
  onCreateRange,
  onEventDragChange,
  onNavigate,
  recenterSignal,
  isBlocked,
}: {
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  visibleDays: number;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  onCreateRange?: ((start: Date, end: Date) => void) | undefined;
  onEventDragChange?: ((dragging: boolean) => void) | undefined;
  onNavigate?: (() => void) | undefined;
  recenterSignal?: number | undefined;
  isBlocked?: (() => boolean) | undefined;
}) {
  const totalDays = BUFFER * 2 + visibleDays;
  const [windowStart, setWindowStart] = useState(() => addDays(startOfDay(anchor), -BUFFER));
  const index = differenceInCalendarDays(startOfDay(anchor), windowStart);
  const [columnWidth, setColumnWidth] = useState(0);
  const outerRef = useRef<HTMLDivElement | null>(null);

  const handleIndexChange = useCallback(
    (next: number) => {
      onAnchorChange(addDays(windowStart, next));
    },
    [onAnchorChange, windowStart],
  );

  const { hostRef, align } = useDayStrip({
    columnWidth,
    index,
    onIndexChange: handleIndexChange,
    onNavigate,
    isBlocked,
    alignKey: `${windowStart.getTime()}:${visibleDays}`,
  });

  // Measure the strip so each day column is exactly viewport / visibleDays wide.
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth - GUTTER_PX;
      if (available > 0) setColumnWidth(available / visibleDays);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleDays]);

  // Keep a generous buffer on both sides: rebase only once scrolling has settled
  // (this runs after a committed index change), then re-align without motion.
  useEffect(() => {
    if (index >= EDGE && index <= totalDays - visibleDays - EDGE) return;
    setWindowStart(addDays(startOfDay(anchor), -BUFFER));
  }, [anchor, index, totalDays, visibleDays]);

  // External jumps (Today, arrows, view switches) land exactly on their column.
  useLayoutEffect(() => {
    align();
  }, [align, recenterSignal]);

  return (
    <div ref={outerRef} className="flex min-h-0 flex-1 flex-col">
      {columnWidth > 0 ? (
        <WeekView
          anchor={windowStart}
          events={events}
          selectedMembers={selectedMembers}
          days={totalDays}
          dayWidth={columnWidth}
          scrollHostRef={hostRef}
          onCreateRange={onCreateRange}
          onEventDragChange={onEventDragChange}
          recenterSignal={recenterSignal}
          bare
          fill
          active
        />
      ) : null}
    </div>
  );
}
