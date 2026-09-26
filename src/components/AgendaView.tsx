import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { Baby, ClipboardPaste } from "lucide-react";

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

            {coverage.map((o) => (
              <CoverageRow key={o.key} occurrence={o} />
            ))}


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
 * Background-layer row. The symbol and tint come from the calendar's own
 * appearance settings; the caregiver face is only the fallback when no symbol
 * has been chosen.
 */
function CoverageRow({ occurrence }: { occurrence: Occurrence }) {
  const { openOccurrence, categoryAppearanceFor } = useCalendar();
  const appearance = categoryAppearanceFor(occurrence.event);
  const Icon = calendarIconComponent(appearance.icon) ?? Baby;
  const tint = appearance.icon || appearance.muted ? eventTintClass(appearance) : "bg-coverage/60";

  return (
    <button
      type="button"
      title={appearance.label}
      onClick={() => openOccurrence(occurrence)}
      className={cn(
        "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-muted-foreground",
        tint,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className={`min-w-0 truncate ${EVENT_TYPE_SCALE.day.title}`}>
        {occurrence.event.title}
      </span>
      <span
        className={`shrink-0 truncate ${EVENT_TYPE_SCALE.day.time} ${eventTimeToneClass(true)}`}
      >
        {formatTimeRange(occurrence.start, occurrence.end, occurrence.event.all_day)}
      </span>
    </button>
  );
}

