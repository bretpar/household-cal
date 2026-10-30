import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek } from "date-fns";
import { ChevronDown, ChevronUp, ClipboardPaste } from "lucide-react";

import { MonthView } from "@/components/MonthView";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { useHorizontalSwipe } from "@/hooks/use-horizontal-swipe";
import { useCalendar } from "@/lib/calendar-store";
import { eventAccentClass } from "@/lib/event-colors";
import { expandOccurrences, formatTimeRange, isCoverage, occurrenceMatchesFilter, occurrenceOccursOnDay, type CalendarEvent, type MemberId } from "@/lib/family-data";
import { cn } from "@/lib/utils";

/** Compact phone overview and agenda share the existing occurrence/date rules. */
export function MobileMonthView({
  selectedDay, events, selectedMembers, onSelectDay, onNavigate, onPaste, onCreateAt,
  weekStartsOn, loading, loadError,
}: {
  selectedDay: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  onSelectDay: (day: Date) => void;
  onNavigate: (direction: 1 | -1) => void;
  onPaste?: ((day: Date) => void) | undefined;
  onCreateAt?: ((day: Date, withTime: boolean) => void) | undefined;
  weekStartsOn: 0 | 1;
  loading: boolean;
  loadError: boolean;
}) {
  const { openOccurrence, categoryAppearanceFor } = useCalendar();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState({ up: false, down: false });
  const updateMore = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return setMore({ up: false, down: false });
    const up = node.scrollTop > 1;
    const down = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setMore((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
  }, []);
  // New day or month: agenda starts at the top.
  const dayKey = format(selectedDay, "yyyy-MM-dd");
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    updateMore();
  }, [dayKey, updateMore]);
  const swipe = useHorizontalSwipe({
    onSwipeLeft: () => onNavigate(1),
    onSwipeRight: () => onNavigate(-1),
    sensitivity: "month",
  });
  const occurrences = expandOccurrences(
    events,
    startOfWeek(startOfMonth(selectedDay), { weekStartsOn }),
    endOfWeek(endOfMonth(selectedDay), { weekStartsOn }),
  ).filter((o) => occurrenceOccursOnDay(o, selectedDay) &&
    (isCoverage(o.event) || occurrenceMatchesFilter(o, selectedMembers)));
  const listSignature = occurrences.map((o) => o.key).join("|");
  useEffect(() => {
    updateMore();
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateMore);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [listSignature, loading, loadError, updateMore]);
  // Agenda gestures never reach month/date swipe handlers above it.
  const contain = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div {...swipe} className="shrink-0">
        <MonthView month={selectedDay} events={events} selectedMembers={selectedMembers}
          onSelectDay={onSelectDay} selectedDay={selectedDay} onCreateAt={onCreateAt}
          weekStartsOn={weekStartsOn} bare compact />
      </div>
      <section aria-label={format(selectedDay, "EEEE, MMMM d")} className="flex min-h-0 flex-1 flex-col border-t border-border-soft px-3 pt-1 pb-0.5">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-0.5">
          <h2 className="min-w-0 text-sm font-bold">{format(selectedDay, "EEEE, MMMM d")}</h2>
          {onPaste ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Paste copied event" title="Paste copied event" onClick={() => onPaste(selectedDay)}>
              <ClipboardPaste />
            </Button>
          ) : null}
        </header>
        <div className="relative flex min-h-0 max-h-[13.5rem] flex-1 flex-col">
        <div ref={scrollRef} onScroll={updateMore}
          onTouchStart={contain} onTouchMove={contain} onTouchEnd={contain}
          onPointerDown={contain} onPointerMove={contain} onPointerUp={contain}
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-4 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]">
        {loading ? <p role="status" className="py-3 text-sm text-muted-foreground">Loading events…</p>
          : loadError ? <p role="status" className="py-3 text-sm text-destructive">Couldn’t load events. Pull to refresh or reopen the app.</p>
          : occurrences.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Nothing scheduled</p>
          : <div className="divide-y divide-border-soft">
            {occurrences.map((o) => {
              const appearance = categoryAppearanceFor(o.event);
              return (
                <Button key={o.key} variant="ghost" data-occurrence="" onClick={() => openOccurrence(o)}
                  className="relative grid h-auto min-h-[3.25rem] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-none py-1.5 pr-0 pl-3 text-left whitespace-normal">
                  <span aria-hidden className={cn("absolute top-1.5 bottom-1.5 left-0 w-1 rounded-full", eventAccentClass(appearance))} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-5 font-semibold break-words [overflow-wrap:anywhere]">{o.event.title}</span>
                    <span className="mt-0 block text-xs leading-4 font-normal text-muted-foreground">{!o.event.all_day && !isSameDay(o.start, o.end)
                      ? `${format(o.start, "MMM d, h:mm a")} – ${format(o.end, "MMM d, h:mm a")}`
                      : formatTimeRange(o.start, o.end, o.event.all_day)} · {appearance.label}</span>
                  </span>
                  <MemberBadgeRow ids={o.member_ids} size="base" className="max-w-24 flex-wrap justify-end pt-0.5" />
                </Button>
              );
            })}
          </div>}
        </div>
        {more.up ? <ChevronUp aria-hidden className="pointer-events-none absolute top-0 right-0 h-4 w-4 text-muted-foreground/50" /> : null}
        {more.down ? <ChevronDown aria-hidden className="pointer-events-none absolute right-0 bottom-0 h-4 w-4 text-muted-foreground/50" /> : null}
        </div>
      </section>
    </div>
  );
}