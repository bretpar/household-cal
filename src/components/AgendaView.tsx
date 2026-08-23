import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { Baby } from "lucide-react";

import { EventCard } from "@/components/EventCard";
import {
  expandOccurrences,
  formatTimeRange,
  isCoverage,
  matchesFilter,
  type CalendarEvent,
  type MemberId,
} from "@/lib/family-data";

export function AgendaView({
  anchor,
  events,
  selectedMembers,
  days = 1,
}: {
  anchor: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  days?: number;
}) {
  const start = startOfDay(anchor);
  const occurrences = expandOccurrences(events, start, addDays(start, days));
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));

  return (
    <div className="space-y-6">
      {dayList.map((day) => {
        const dayOccurrences = occurrences.filter((o) => isSameDay(o.start, day));
        const coverage = dayOccurrences.filter((o) => isCoverage(o.event));
        const visible = dayOccurrences.filter(
          (o) => !isCoverage(o.event) && matchesFilter(o.event, selectedMembers),
        );

        return (
          <section key={day.toISOString()} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold">{format(day, "EEEE")}</h2>
              <span className="text-sm font-semibold text-muted-foreground">
                {format(day, "MMM d")}
              </span>
            </div>

            {coverage.map((o) => (
              <div
                key={o.key}
                className="flex items-center gap-2 rounded-2xl bg-coverage-strong/70 px-3 py-2 text-xs font-bold text-coverage-foreground"
              >
                <Baby className="h-4 w-4" aria-hidden />
                {o.event.title} {formatTimeRange(o.start, o.end, false)}
              </div>
            ))}

            {visible.length === 0 ? (
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
