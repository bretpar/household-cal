import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { addMonths, format, isSameMonth, startOfMonth } from "date-fns";

import { MonthView } from "@/components/MonthView";
import { cn } from "@/lib/utils";
import type { CalendarEvent, MemberId } from "@/lib/family-data";

/** Months rendered before / after the anchor month so scrolling never runs out. */
const MONTHS_BEFORE = 6;
const MONTHS_AFTER = 12;

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
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Anchor = the week row containing the 1st of each month (the grid start). */
  const anchorRefs = useRef(new Map<string, HTMLDivElement>());
  const reportedRef = useRef<string | null>(null);

  // The rendered window is anchored once per mount-month; scrolling never
  // rebuilds it, so the surface stays perfectly stationary while reading.
  const baseMonth = useMemo(() => startOfMonth(anchor), [anchor.getFullYear(), anchor.getMonth()]);
  const months = useMemo(
    () =>
      Array.from(
        { length: MONTHS_BEFORE + MONTHS_AFTER + 1 },
        (_, i) => addMonths(baseMonth, i - MONTHS_BEFORE),
      ),
    [baseMonth],
  );

  const key = (month: Date) => format(month, "yyyy-MM");

  const scrollToMonth = useCallback((month: Date, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    const anchorEl = anchorRefs.current.get(format(startOfMonth(month), "yyyy-MM"));
    if (!container || !anchorEl) return;
    container.scrollTo({
      top: anchorEl.offsetTop,
      behavior: prefersReducedMotion() ? "auto" : behavior,
    });
  }, []);

  // Open on the anchor month without animation.
  useLayoutEffect(() => {
    scrollToMonth(baseMonth, "auto");
    reportedRef.current = key(baseMonth);
  }, [baseMonth, scrollToMonth]);


  // Report the month whose boundary has reached the top of the viewport. A
  // small tolerance keeps the label on the outgoing month while its trailing
  // week is still passing the top edge.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const top = container.scrollTop + 2;
      let active: Date | null = null;
      for (const month of months) {
        const anchorEl = anchorRefs.current.get(key(month));
        if (!anchorEl) continue;
        if (anchorEl.offsetTop <= top) active = month;
        else break;
      }
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
        <div
          key={key(month)}
          ref={(node) => {
            if (node) sectionRefs.current.set(key(month), node);
            else sectionRefs.current.delete(key(month));
          }}
          data-month={key(month)}
          className="scroll-mt-0"
        >
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
      ))}
    </div>
  );
});
