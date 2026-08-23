import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Baby } from "lucide-react";

import { cn } from "@/lib/utils";
import { EventPill } from "@/components/EventCard";
import {
  expandOccurrences,
  isCoverage,
  matchesFilter,
  type CalendarEvent,
  type MemberId,
} from "@/lib/family-data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({
  month,
  events,
  selectedMembers,
  onSelectDay,
}: {
  month: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  onSelectDay: (day: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const occurrences = expandOccurrences(events, gridStart, gridEnd);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  return (
    <div className="overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-soft">
      <div className="grid grid-cols-7 border-b border-border-soft bg-surface-muted">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-[11px] font-bold tracking-wide text-muted-foreground uppercase"
          >
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{day[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayOccurrences = occurrences.filter((o) => isSameDay(o.start, day));
          const coverage = dayOccurrences.filter((o) => isCoverage(o.event));
          const visible = dayOccurrences.filter(
            (o) => !isCoverage(o.event) && matchesFilter(o.event, selectedMembers),
          );
          const inMonth = isSameMonth(day, month);
          const today = isSameDay(day, new Date());

          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              aria-label={format(day, "EEEE, MMMM d")}
              onClick={() => onSelectDay(day)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectDay(day);
                }
              }}
              className={cn(
                "relative min-h-[92px] cursor-pointer border-t border-l border-border-soft p-1.5 text-left align-top transition-colors first:border-l-0 hover:bg-secondary/60 sm:min-h-[124px] sm:p-2",
                !inMonth && "opacity-45",
                coverage.length > 0 && "bg-coverage/70",
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    today ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
                {coverage.length > 0 ? (
                  <Baby
                    className="h-3.5 w-3.5 text-coverage-foreground"
                    aria-label="Babysitter coverage"
                  />
                ) : null}
              </div>
              <div className="space-y-1">
                {visible.slice(0, 3).map((occurrence) => (
                  <EventPill key={occurrence.key} occurrence={occurrence} />
                ))}
                {visible.length > 3 ? (
                  <p className="px-1 text-[10px] font-semibold text-muted-foreground">
                    +{visible.length - 3} more
                  </p>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
