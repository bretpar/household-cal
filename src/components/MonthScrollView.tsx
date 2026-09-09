import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addMonths,
  differenceInCalendarMonths,
  format,
  isSameMonth,
  startOfMonth,
} from "date-fns";

import { MonthView } from "@/components/MonthView";
import { cn } from "@/lib/utils";
import type { CalendarEvent, MemberId } from "@/lib/family-data";

/** Months rendered before / after the anchor month at first paint. */
const MONTHS_BEFORE = 6;
const MONTHS_AFTER = 12;
/** How many months to add each time scrolling nears an edge. */
const GROW_STEP = 6;
/** Distance from an edge (px) that triggers growing the rendered window. */
const GROW_THRESHOLD = 900;


export type MonthScrollHandle = {
  /** Smoothly scroll so the given month's boundary sits at the top. */
  scrollToMonth: (month: Date, behavior?: ScrollBehavior) => void;
  /** Smoothly bring today's month (and week) into comfortable view. */
  scrollToToday: (behavior?: ScrollBehavior) => void;
  /** Month currently at the top boundary of the viewport. */
  currentMonth: () => Date;
};

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Apple-Calendar-style Month view: one continuous vertical calendar surface of
 * consecutive months. Native vertical scrolling and momentum own the gesture;
 * the only derived state is which month boundary currently sits at the top,
 * which is reported upward for the stationary header label.
 */
export const MonthScrollView = forwardRef<
  MonthScrollHandle,
  {
    anchor: Date;
    events: CalendarEvent[];
    selectedMembers: MemberId[];
    onSelectDay: (day: Date) => void;
    onPaste?: ((day: Date) => void) | undefined;
    onCreateAt?: ((day: Date, withTime: boolean) => void) | undefined;
    weekStartsOn?: 0 | 1;
    /** Called when a different month reaches the top of the scroll viewport. */
    onVisibleMonthChange?: (month: Date) => void;
    /** Horizontal swipe: +1 = next month, -1 = previous month. */
    onSwipeMonth?: (direction: 1 | -1) => void;
  }
>(function MonthScrollView(
  {
    anchor,
    events,
    selectedMembers,
    onSelectDay,
    onPaste,
    onCreateAt,
    weekStartsOn = 1,
    onVisibleMonthChange,
    onSwipeMonth,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Anchor = the week row containing the 1st of each month (the grid start). */
  const anchorRefs = useRef(new Map<string, HTMLDivElement>());
  const reportedRef = useRef<string | null>(null);

  // The rendered window starts around the mount-month and grows outward as the
  // user scrolls or navigates, so Month view is never capped at a fixed range.
  const baseMonth = useMemo(() => startOfMonth(anchor), [anchor.getFullYear(), anchor.getMonth()]);
  const [range, setRange] = useState({ before: MONTHS_BEFORE, after: MONTHS_AFTER });
  useEffect(() => {
    setRange({ before: MONTHS_BEFORE, after: MONTHS_AFTER });
  }, [baseMonth]);

  const months = useMemo(
    () =>
      Array.from(
        { length: range.before + range.after + 1 },
        (_, i) => addMonths(baseMonth, i - range.before),
      ),
    [baseMonth, range],
  );

  const key = (month: Date) => format(month, "yyyy-MM");

  /** Pending scroll target that awaits the month being mounted. */
  const pendingScrollRef = useRef<{ month: Date; behavior: ScrollBehavior } | null>(null);
  /** Scroll metrics captured just before months are prepended. */
  const growTopRef = useRef<{ height: number; top: number } | null>(null);

  /** Top offset of a month's week-of-the-1st row, in scroll coordinates. */
  const anchorTop = (container: HTMLDivElement, id: string) => {
    const row = container.querySelector<HTMLElement>(`[data-month-start="${id}"]`);
    if (!row) return null;
    return (
      row.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    );
  };

  /** Grow the window so `month` is rendered with a little room around it. */
  const ensureRange = useCallback(
    (month: Date) => {
      const diff = differenceInCalendarMonths(startOfMonth(month), baseMonth);
      setRange((prev) => {
        const before = diff < 0 ? Math.max(prev.before, -diff + GROW_STEP) : prev.before;
        const after = diff > 0 ? Math.max(prev.after, diff + GROW_STEP) : prev.after;
        if (before === prev.before && after === prev.after) return prev;
        return { before, after };
      });
    },
    [baseMonth],
  );

  const scrollToMonth = useCallback(
    (month: Date, behavior: ScrollBehavior = "smooth") => {
      const container = scrollRef.current;
      if (!container) return;
      const top = anchorTop(container, format(startOfMonth(month), "yyyy-MM"));
      if (top == null) {
        // Not rendered yet: extend the window and finish the scroll once it is.
        pendingScrollRef.current = { month, behavior };
        ensureRange(month);
        return;
      }
      container.scrollTo({
        top,
        behavior: prefersReducedMotion() ? "auto" : behavior,
      });
    },
    [ensureRange],
  );

  // Open on the anchor month without animation.
  useLayoutEffect(() => {
    scrollToMonth(baseMonth, "auto");
    reportedRef.current = key(baseMonth);
  }, [baseMonth, scrollToMonth]);

  // After the window grows: keep the reading position stable when months were
  // prepended, and complete any scroll that was waiting on a month to mount.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const grown = growTopRef.current;
    if (grown) {
      growTopRef.current = null;
      const delta = container.scrollHeight - grown.height;
      if (delta > 0) container.scrollTop = grown.top + delta;
    }
    const pending = pendingScrollRef.current;
    if (pending) {
      const top = anchorTop(container, format(startOfMonth(pending.month), "yyyy-MM"));
      if (top != null) {
        pendingScrollRef.current = null;
        container.scrollTo({
          top,
          behavior: prefersReducedMotion() ? "auto" : pending.behavior,
        });
      }
    }
  }, [months]);

  // Grow the window when scrolling approaches either edge.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      if (container.scrollTop < GROW_THRESHOLD) {
        growTopRef.current = { height: container.scrollHeight, top: container.scrollTop };
        setRange((prev) => ({ ...prev, before: prev.before + GROW_STEP }));
      } else if (
        container.scrollHeight - container.scrollTop - container.clientHeight <
        GROW_THRESHOLD
      ) {
        setRange((prev) => ({ ...prev, after: prev.after + GROW_STEP }));
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(check);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", onScroll);
    };
  }, [months]);



  // Report the month whose boundary has reached the top of the viewport. A
  // small tolerance keeps the label on the outgoing month while its trailing
  // week is still passing the top edge.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      // Measure every mounted week-of-the-1st row against the container's top
      // edge in one pass; rects are immune to variable row heights and to any
      // offsetParent differences.
      const containerTop = container.getBoundingClientRect().top;
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-month-start]"),
      );
      const measured = rows
        .map((row) => ({
          id: row.dataset["monthStart"] ?? "",
          offset: row.getBoundingClientRect().top - containerTop,
        }))
        .filter((row) => row.id)
        .sort((a, b) => a.offset - b.offset);

      // Latest anchor at or above the top boundary (1.5px subpixel tolerance);
      // scrolling back up naturally falls through to the previous anchor.
      const crossed = measured.filter((row) => row.offset <= 1.5).pop();
      const activeId = crossed?.id ?? measured[0]?.id ?? null;
      let active = activeId ? months.find((m) => key(m) === activeId) ?? null : null;
      if (!active) active = months[0] ?? null;
      if (!active) return;
      const id = key(active);
      if (id === reportedRef.current) return;
      reportedRef.current = id;
      onVisibleMonthChange?.(active);
    };


    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(evaluate);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", onScroll);
    };
  }, [months, onVisibleMonthChange]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToMonth,
      scrollToToday: (behavior: ScrollBehavior = "smooth") => scrollToMonth(new Date(), behavior),
      currentMonth: () => {
        const id = reportedRef.current;
        const found = months.find((m) => key(m) === id);
        return found ?? baseMonth;
      },
    }),
    [baseMonth, months, scrollToMonth],
  );

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
    >
      {months.map((month) => (
        <div key={key(month)} data-month={key(month)} className="scroll-mt-0">
          <div className="flex items-baseline gap-2 px-3 pt-4 pb-1.5 sm:px-4">
            <h2
              className={cn(
                "text-lg font-bold tracking-tight sm:text-xl",
                isSameMonth(month, new Date()) ? "text-primary" : "text-foreground",
              )}
            >
              {format(month, "MMMM")}
            </h2>
            <span className="text-sm font-semibold text-muted-foreground">
              {format(month, "yyyy")}
            </span>
          </div>
          <div
            ref={(node) => {
              if (node) anchorRefs.current.set(key(month), node);
              else anchorRefs.current.delete(key(month));
            }}
            data-month-anchor={key(month)}
          >
            <MonthView
              month={month}
              events={events}
              selectedMembers={selectedMembers}
              onSelectDay={onSelectDay}
              onPaste={onPaste}
              onCreateAt={onCreateAt}
              weekStartsOn={weekStartsOn}
              bare
            />
          </div>
        </div>
      ))}

    </div>
  );
});
