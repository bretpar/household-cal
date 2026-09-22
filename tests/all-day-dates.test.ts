import { describe, expect, it } from "vitest";

import {
  dayKey,
  eventEndDay,
  eventStartDay,
  expandOccurrences,
  localDateFromKey,
  type CalendarEvent,
} from "@/lib/family-data";

function allDayEvent(startKey: string, endKey = startKey): CalendarEvent {
  return {
    id: "e1",
    family_id: "f1",
    calendar_source_id: "c1",
    display_mode: "events",
    read_only: true,
    title: "VA Backup Call",
    // Google / ICS date-only values are stored at UTC midnight.
    start_at: `${startKey}T00:00:00.000Z`,
    end_at: `${endKey}T00:00:00.000Z`,
    all_day: true,
    location: null,
    notes: null,
    event_type: "other",
    recurrence_rule: null,
    recurrence_until: null,
    excluded_dates: [],
    category_id: null,
    external_event_id: "x",
    external_recurring_event_id: null,
    participants: [],
    member_ids: [],
    needs_family_assignment: false,
  };
}

describe("date-only calendar values stay local calendar dates", () => {
  it("never shifts a date-only key through UTC", () => {
    expect(dayKey(localDateFromKey("2026-09-30"))).toBe("2026-09-30");
  });

  it("keeps a Google all-day event on its own date", () => {
    const event = allDayEvent("2026-09-30");
    expect(dayKey(eventStartDay(event))).toBe("2026-09-30");
    expect(dayKey(eventEndDay(event))).toBe("2026-09-30");

    const occurrences = expandOccurrences(
      [event],
      localDateFromKey("2026-09-27"),
      localDateFromKey("2026-10-03"),
    );
    expect(occurrences).toHaveLength(1);
    expect(dayKey(occurrences[0]!.start)).toBe("2026-09-30");
    // No artificial clock time: it belongs in the all-day band.
    expect(occurrences[0]!.start.getHours()).toBe(0);
    expect(occurrences[0]!.end.getHours()).toBe(23);
  });

  it("covers every date of a multi-day all-day range", () => {
    const occurrences = expandOccurrences(
      [allDayEvent("2026-09-30", "2026-10-02")],
      localDateFromKey("2026-09-27"),
      localDateFromKey("2026-10-05"),
    );
    expect(occurrences.map((o) => dayKey(o.start))).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

describe("all-day events created inside the app", () => {
  it("stores a single-day all-day event on one date only", async () => {
    const { draftFromFormState, emptyFormState } = await import("@/components/EventForm");
    const state = { ...emptyFormState(localDateFromKey("2026-09-21"), false), allDay: true, title: "Birthday" };
    const draft = draftFromFormState(state);
    const event = { ...allDayEvent("2026-09-21"), start_at: draft.start_at, end_at: draft.end_at };
    const occurrences = expandOccurrences(
      [event],
      localDateFromKey("2026-09-19"),
      localDateFromKey("2026-09-25"),
    );
    expect(occurrences.map((o) => dayKey(o.start))).toEqual(["2026-09-21"]);
  });

  it("reads legacy local-time all-day rows as one day", () => {
    const event = {
      ...allDayEvent("2026-09-21"),
      start_at: new Date("2026-09-21T00:00").toISOString(),
      end_at: new Date("2026-09-21T23:59").toISOString(),
    };
    expect(dayKey(eventStartDay(event))).toBe("2026-09-21");
    expect(dayKey(eventEndDay(event))).toBe("2026-09-21");
  });
});
