import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { Baby, Briefcase, ChevronRight, ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EventCard } from "@/components/EventCard";
import { calendarIconComponent } from "@/lib/calendar-icons";
import { useCalendar } from "@/lib/calendar-store";
import { eventTintClass } from "@/lib/event-colors";
import { EVENT_TYPE_SCALE, eventTimeToneClass } from "@/lib/event-typography";
import { cn } from "@/lib/utils";
import {
  expandOccurrences,
  formatTimeRange,
  isChildcare,
  isCoverage,
  occurrenceMatchesFilter,
  type CalendarEvent,
  type MemberId,
  type Occurrence,
} from "@/lib/family-data";


export function AgendaView({
  anchor,
  events,
  selectedMembers,
  days = 1,
  onPaste,
  loading = false,
  loadError = false,
}: {
  /** initial load still running: show placeholders, never "Nothing scheduled" */
  loading?: boolean;
  /** initial load failed: say so instead of showing an empty schedule */
  loadError?: boolean;
  anchor: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  days?: number;
  /** provided only when an event is copied and the user may create events */
  onPaste?: ((day: Date) => void) | undefined;
}) {
  const { openOccurrence } = useCalendar();
  const start = startOfDay(anchor);
  const occurrences = expandOccurrences(events, start, addDays(start, days));
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));

  return (
    <div className="space-y-6">
      {dayList.map((day) => {
        const dayOccurrences = occurrences.filter((o) => isSameDay(o.start, day));
        // Childcare reads as a soft care-coverage strip above the day's events.
        const coverage = dayOccurrences.filter((o) => isCoverage(o.event) || isChildcare(o.event));
        const visible = dayOccurrences.filter(
          (o) =>
            !isCoverage(o.event) &&
            !isChildcare(o.event) &&
            occurrenceMatchesFilter(o, selectedMembers),
        );

        return (
          <section key={day.toISOString()} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold">{format(day, "EEEE")}</h2>
              <span className="text-sm font-semibold text-muted-foreground">
                {format(day, "MMM d")}
              </span>
              {onPaste ? (
                <button
                  type="button"
                  onClick={() => onPaste(day)}
                  className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-primary/15 px-3 text-xs font-bold text-primary"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
                  Paste copied event
                </button>
              ) : null}
            </div>

            <BackgroundStrip coverage={coverage} />


            {loading ? (
              <div className="space-y-2" aria-hidden>
                <div className="h-14 animate-pulse rounded-2xl bg-secondary/70" />
              </div>
            ) : loadError ? (
              <p className="rounded-2xl border border-dashed border-destructive/40 bg-surface px-3 py-5 text-center text-sm text-destructive">
                Couldn’t load events. Pull to refresh or reopen the app.
              </p>
            ) : visible.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-surface px-3 py-5 text-center text-sm text-muted-foreground">
                Nothing scheduled
              </p>
            ) : (
              <div className="space-y-2">
                {visible.map((o) => (
                  <EventCard key={o.key} occurrence={o} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One compact 50/50 row: caregiver coverage fixed on the left, secondary
 * work/background calendars on the right (horizontally swipeable, muted).
 * Either half takes the full row when the other is empty.
 */
function BackgroundStrip({ coverage }: { coverage: Occurrence[] }) {
  const { openOccurrence, categoryAppearanceFor, family } = useCalendar();
  const babysitterSourceId = family?.babysitter_calendar_source_id ?? null;
  const isCare = (o: Occurrence) =>
    isChildcare(o.event) ||
    (!!babysitterSourceId && o.event.calendar_source_id === babysitterSourceId);
  const care = coverage.filter(isCare);
  const work = coverage.filter((o) => !isCare(o));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [work.length]);

  if (coverage.length === 0) return null;
  const time = (o: Occurrence) => formatTimeRange(o.start, o.end, o.event.all_day);
  const WorkIcon =
    (work[0] && calendarIconComponent(categoryAppearanceFor(work[0].event).icon)) ?? Briefcase;

  return (
    <div className={cn("grid gap-2", care.length && work.length ? "grid-cols-2" : "grid-cols-1")}>
      {care.length ? (
        <div className="flex min-w-0 flex-col gap-1">
          {care.map((o) => {
            const appearance = categoryAppearanceFor(o.event);
            const Icon = calendarIconComponent(appearance.icon) ?? Baby;
            const tint =
              appearance.icon || appearance.muted ? eventTintClass(appearance) : "bg-coverage/70";
            return (
              <button
                key={o.key}
                type="button"
                title={appearance.label}
                onClick={() => openOccurrence(o)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-left text-foreground",
                  tint,
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{o.event.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{time(o)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {work.length ? (
        <div className="relative flex min-w-0 items-center rounded-2xl bg-surface-muted/70 text-muted-foreground">
          <WorkIcon className="ml-3 h-4 w-4 shrink-0" aria-hidden />
          <div
            ref={scrollRef}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2 pr-6 pl-2 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="shrink-0 text-xs font-bold text-foreground/80">Work:</span>
            {work.map((o, i) => (
              <button
                key={o.key}
                type="button"
                onClick={() => openOccurrence(o)}
                className="shrink-0 text-xs"
              >
                {i > 0 ? <span aria-hidden className="mr-1">·</span> : null}
                {o.event.title} {time(o)}
              </button>
            ))}
          </div>
          {more ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end rounded-r-2xl bg-gradient-to-l from-surface-muted to-transparent pr-1"
            >
              <ChevronRight className="h-4 w-4" />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


