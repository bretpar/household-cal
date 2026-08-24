/**
 * Drag-and-drop rescheduling.
 *
 * Turns "this occurrence was dropped at a new day/time" into the same
 * `EventDraft` the edit form produces, so the existing recurrence-scope logic
 * (this / this and future / entire series) stays the single source of truth.
 *
 * Recurrence is preserved rather than rebuilt:
 *  - the frequency, interval and occurrence count are untouched
 *  - a weekly BYDAY list is shifted by the same number of days as the drop, so
 *    a Mon–Thu series dropped one day later becomes Tue–Fri
 *  - per-person weekday rules shift by the same amount, keeping one series
 *  - the recurrence end date is carried over unchanged
 */

import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import type { EventDraft, RecurrenceScope } from "@/lib/calendar-store";
import type { Occurrence, WeekdayCode } from "@/lib/family-data";

const ORDER: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function shiftWeekday(code: WeekdayCode, delta: number): WeekdayCode {
  const index = ORDER.indexOf(code);
  if (index < 0) return code;
  return ORDER[(((index + delta) % 7) + 7) % 7]!;
}

/** Shifts only the BYDAY part of a simplified RRULE; everything else is kept verbatim. */
export function shiftRuleWeekdays(rule: string | null, dayDelta: number): string | null {
  if (!rule || rule === "CUSTOM" || dayDelta % 7 === 0) return rule;
  return rule
    .split(";")
    .map((part) =>
      part.startsWith("BYDAY=")
        ? `BYDAY=${part
            .slice(6)
            .split(",")
            .map((code) => shiftWeekday(code as WeekdayCode, dayDelta))
            .join(",")}`
        : part,
    )
    .join(";");
}

function withTimeOf(day: Date, time: Date): Date {
  const next = new Date(day);
  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return next;
}

export function isRecurring(occurrence: Occurrence): boolean {
  return Boolean(occurrence.event.recurrence_rule);
}

/**
 * `newStart` is the dropped start moment. The event keeps its duration.
 * `scope` is ignored for non-recurring events (they always move outright).
 */
export function rescheduleDraft(
  occurrence: Occurrence,
  newStart: Date,
  scope: RecurrenceScope,
): EventDraft {
  const { event } = occurrence;
  const duration = occurrence.end.getTime() - occurrence.start.getTime();
  const dayDelta = differenceInCalendarDays(startOfDay(newStart), startOfDay(occurrence.start));
  const detach = scope === "this" && Boolean(event.recurrence_rule);

  // "this" turns the dropped occurrence into a one-off; the other scopes keep the series
  const start = detach || !event.recurrence_rule || scope === "future"
    ? newStart
    : withTimeOf(addDays(new Date(event.start_at), dayDelta), newStart);
  const end = new Date(start.getTime() + duration);

  const rule = detach ? null : shiftRuleWeekdays(event.recurrence_rule, dayDelta);

  const memberWeekdays: Record<string, WeekdayCode[] | null> = {};
  if (!detach) {
    for (const participant of event.participants) {
      memberWeekdays[participant.member_id] =
        participant.weekdays && participant.weekdays.length > 0
          ? participant.weekdays.map((code) => shiftWeekday(code, dayDelta))
          : null;
    }
  }

  return {
    title: event.title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: event.all_day,
    location: event.location,
    notes: event.notes,
    event_type: event.event_type,
    recurrence_rule: rule,
    recurrence_until: rule ? event.recurrence_until : null,
    calendar_source_id: event.calendar_source_id,
    member_ids: detach ? [...occurrence.member_ids] : [...event.member_ids],
    member_weekdays: memberWeekdays,
  };
}
