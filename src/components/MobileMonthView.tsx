import { useLayoutEffect, useRef } from "react";
import { endOfMonth, endOfWeek, format, isSameDay, startOfMonth, startOfWeek } from "date-fns";
import { ClipboardPaste } from "lucide-react";

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
  const monthKey = format(selectedDay, "yyyy-MM");
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [monthKey]);
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

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
      <div {...swipe}>
        <MonthView month={selectedDay} events={events} selectedMembers={selectedMembers}
          onSelectDay={onSelectDay} selectedDay={selectedDay} onCreateAt={onCreateAt}
          weekStartsOn={weekStartsOn} bare compact />
      </div>
      <section aria-label={format(selectedDay, "EEEE, MMMM d")} className="border-t border-border-soft px-3 pt-3 pb-4">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-2">
          <h2 className="min-w-0 text-sm font-bold">{format(selectedDay, "EEEE, MMMM d")}</h2>
          {onPaste ? (
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Paste copied event" title="Paste copied event" onClick={() => onPaste(selectedDay)}>
              <ClipboardPaste />
            </Button>
          ) : null}
        </header>
        {loading ? <p role="status" className="py-3 text-sm text-muted-foreground">Loading events…</p>
          : loadError ? <p role="status" className="py-3 text-sm text-destructive">Couldn’t load events. Pull to refresh or reopen the app.</p>
          : occurrences.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Nothing scheduled</p>
          : <div className="divide-y divide-border-soft">
            {occurrences.map((o) => {
              const appearance = categoryAppearanceFor(o.event);
              return (
                <Button key={o.key} variant="ghost" data-occurrence="" onClick={() => openOccurrence(o)}
                  className="relative grid h-auto min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-none py-3 pr-0 pl-3 text-left whitespace-normal">
                  <span aria-hidden className={cn("absolute top-3 bottom-3 left-0 w-1 rounded-full", eventAccentClass(appearance))} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-5 font-semibold break-words [overflow-wrap:anywhere]">{o.event.title}</span>
                    <span className="mt-1 block text-xs leading-4 font-normal text-muted-foreground">{!o.event.all_day && !isSameDay(o.start, o.end)
                      ? `${format(o.start, "MMM d, h:mm a")} – ${format(o.end, "MMM d, h:mm a")}`
                      : formatTimeRange(o.start, o.end, o.event.all_day)} · {appearance.label}</span>
                  </span>
                  <MemberBadgeRow ids={o.member_ids} size="base" className="max-w-24 flex-wrap justify-end pt-0.5" />
                </Button>
              );
            })}
          </div>}
      </section>
    </div>
  );
}