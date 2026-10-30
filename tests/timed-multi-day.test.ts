import { describe, expect, it } from "vitest";
import { expandOccurrences, localDateFromKey, occurrenceOccursOnDay, occurrencesForDay, type CalendarEvent } from "@/lib/family-data";

function overnightEvent(endHour: number): CalendarEvent {
  return {
    id: "overnight", family_id: "family", calendar_source_id: "calendar",
    display_mode: "events", read_only: false, title: "Overnight",
    start_at: new Date(2026, 9, 28, 23).toISOString(),
    end_at: new Date(2026, 9, 29, endHour).toISOString(), all_day: false,
    location: null, notes: null, event_type: "other", recurrence_rule: null,
    recurrence_until: null, excluded_dates: [], category_id: null,
    external_event_id: null, external_recurring_event_id: null,
    participants: [], member_ids: [], needs_family_assignment: false,
  };
}

describe("timed multi-day date visibility", () => {
  it("shows October 28 11 PM–October 29 2 AM on both dates with one unchanged identity", () => {
    const event = overnightEvent(2);
    const startDay = localDateFromKey("2026-10-28");
    const nextDay = localDateFromKey("2026-10-29");
    const expanded = expandOccurrences([event], startDay, nextDay);
    expect(expanded).toHaveLength(1);
    for (const day of [startDay, nextDay]) {
      const rows = occurrencesForDay([event], day);
      expect(rows).toHaveLength(1);
      const occurrence = rows[0];
      if (!occurrence) throw new Error("Missing overnight occurrence");
      expect(occurrenceOccursOnDay(occurrence, day)).toBe(true);
      expect(occurrence.event).toBe(event);
      expect(occurrence.start.toISOString()).toBe(event.start_at);
      expect(occurrence.end.toISOString()).toBe(event.end_at);
      expect(occurrence.key).toBe(expanded[0]?.key);
    }
  });

  it("does not occupy October 29 when the event ends exactly at midnight", () => {
    const event = overnightEvent(0);
    const startDay = localDateFromKey("2026-10-28");
    const nextDay = localDateFromKey("2026-10-29");
    const rows = occurrencesForDay([event], startDay);
    expect(rows).toHaveLength(1);
    expect(occurrencesForDay([event], nextDay)).toHaveLength(0);
    const occurrence = rows[0];
    if (!occurrence) throw new Error("Missing starting-day occurrence");
    expect(occurrenceOccursOnDay(occurrence, startDay)).toBe(true);
    expect(occurrenceOccursOnDay(occurrence, nextDay)).toBe(false);
  });
});