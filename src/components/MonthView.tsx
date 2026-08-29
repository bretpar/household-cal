import { useEffect, useRef, useState } from "react";
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
import { Baby, ClipboardPaste } from "lucide-react";

import { cn } from "@/lib/utils";
import { EventPill } from "@/components/EventCard";
import { useReschedule } from "@/components/useReschedule";
import { useLongPress } from "@/hooks/use-long-press";

import {
  expandOccurrences,
  isCoverage,
  occurrenceMatchesFilter,
  type CalendarEvent,
  type MemberId,
} from "@/lib/family-data";

const MONDAY_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SUNDAY_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({
  month,
  events,
  selectedMembers,
  onSelectDay,
  onPaste,
  onCreateAt,
  weekStartsOn = 1,
  bare = false,
}: {
  month: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  onSelectDay: (day: Date) => void;
  /** provided only when an event is copied and the user may create events */
  onPaste?: ((day: Date) => void) | undefined;
  /** press-and-hold on an empty day; provided only when the user may create events */
  onCreateAt?: ((day: Date, withTime: boolean) => void) | undefined;
  /** 0 = Sunday-first grid, 1 = Monday-first grid */
  weekStartsOn?: 0 | 1;
  /** render without the card frame (parent supplies a stationary one) */
  bare?: boolean;
}) {
  const { dragProps, dropProps, draggingKey, dialog } = useReschedule();
  const WEEKDAYS = weekStartsOn === 0 ? SUNDAY_FIRST : MONDAY_FIRST;
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn });
  const occurrences = expandOccurrences(events, gridStart, gridEnd);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  // Press-and-hold an empty day to create an event. The day is captured on
  // pointer down so a single hook can serve every cell.
  const pressedDay = useRef<Date | null>(null);
  const longPressProps = useLongPress(
    onCreateAt ? () => {
      const day = pressedDay.current;
      if (day) onCreateAt(day, false);
    } : undefined,
    {
      shouldIgnore: (target) =>
        target instanceof Element && Boolean(target.closest("[data-occurrence],button")),
    },
  );




  /** Month cells only change the day; the event keeps its time of day. */
  const sameTimeOn = (day: Date, occurrence: { start: Date }) => {
    const next = new Date(day);
    next.setHours(occurrence.start.getHours(), occurrence.start.getMinutes(), 0, 0);
    return next;
  };


  return (
    <>
      {dialog}
    <div
      className={cn(
        "calendar-gesture-surface overflow-hidden",
        !bare && "rounded-3xl border border-border-soft bg-surface shadow-soft",
      )}
    >
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
            (o) => !isCoverage(o.event) && occurrenceMatchesFilter(o, selectedMembers),
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
              {...dropProps((_e, o) => sameTimeOn(day, o))}
              {...longPressProps}
              onPointerDown={(e) => {
                pressedDay.current = day;
                longPressProps.onPointerDown?.(e);
              }}

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
                {onPaste ? (
                  <button
                    type="button"
                    aria-label={`Paste copied event on ${format(day, "MMMM d")}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPaste(day);
                    }}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </button>
                ) : coverage.length > 0 ? (
                  <Baby
                    className="h-3.5 w-3.5 text-coverage-foreground"
                    aria-label="Caregiver coverage"
                  />
                ) : null}
              </div>
              <div className="space-y-1">
                {visible.slice(0, 3).map((occurrence) => (
                  <div
                    key={occurrence.key}
                    data-occurrence=""
                    {...dragProps(occurrence)}
                    className={cn(draggingKey === occurrence.key && "opacity-40")}
                  >
                    <EventPill occurrence={occurrence} />
                  </div>
                ))}
                {visible.length > 3 ? (
                  <p className="px-1 text-[10px] font-semibold text-muted-foreground">
                    +{visible.length - 3} more
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
