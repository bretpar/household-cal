import { describe, expect, it } from "vitest";

import { layoutTimedEvents } from "@/lib/calendar-layout";
import type { CalendarEvent, Occurrence } from "@/lib/family-data";

function occurrence(key: string, startHour: number, endHour: number): Occurrence {
  const event: CalendarEvent = {
    id: key,
    family_id: "family",
    calendar_source_id: null,
    display_mode: "events",
    title: key,
    start_at: new Date(2026, 8, 17, startHour).toISOString(),
    end_at: new Date(2026, 8, 17, endHour).toISOString(),
    all_day: false,
    location: null,
    notes: null,
    event_type: "activity",
    recurrence_rule: null,
    recurrence_until: null,
    excluded_dates: [],
    category_id: null,
    external_event_id: null,
    external_recurring_event_id: null,
    participants: [],
    member_ids: [],
    needs_family_assignment: false,
  };
  return {
    key,
    event,
    start: new Date(2026, 8, 17, startHour),
    end: new Date(2026, 8, 17, endHour),
    member_ids: [],
  };
}

describe("shared timed-event overlap layout", () => {
  it("gives one foreground event the full width", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("one", 9, 10)],
      coverage: [],
      areaWidth: 160,
    });
    expect(layout.foreground).toHaveLength(1);
    expect(layout.foreground[0]?.widthPct).toBe(100);
    expect(layout.overflow).toHaveLength(0);
  });

  it("always shows exactly two overlapping foreground events as real blocks", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("first", 9, 10), occurrence("second", 9, 11)],
      coverage: [],
      areaWidth: 150,
    });
    expect(layout.foreground.filter((item) => item.top === 9 * 45)).toHaveLength(2);
    expect(layout.overflow).toHaveLength(0);
  });

  it("uses actual width to show three events or collapse only the unreadable lane", () => {
    const events = [
      occurrence("one", 9, 10),
      occurrence("two", 9, 10),
      occurrence("three", 9, 10),
    ];
    const wide = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 420 });
    const narrow = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 250 });
    expect(wide.foreground).toHaveLength(3);
    expect(wide.overflow).toHaveLength(0);
    expect(narrow.foreground).toHaveLength(2);
    expect(narrow.overflow[0]?.hidden.map((item) => item.key)).toEqual(["three"]);
  });

  it("does not count background coverage as a foreground lane", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("first", 9, 10), occurrence("second", 9, 10)],
      coverage: [occurrence("coverage", 8, 12)],
      areaWidth: 300,
    });
    expect(layout.foreground).toHaveLength(2);
    expect(layout.overflow).toHaveLength(0);
  });

  it("lets a long event reclaim full width after a partial overlap ends", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("kids-place", 9, 13), occurrence("little-gym", 9, 10)],
      coverage: [],
      areaWidth: 320,
    });
    const kidsPlace = layout.foreground.filter(
      (item) => item.occurrence.key === "kids-place",
    );
    expect(kidsPlace).toHaveLength(2);
    expect(kidsPlace[0]).toMatchObject({ top: 9 * 45, height: 45, widthPct: 50 });
    expect(kidsPlace[1]).toMatchObject({ top: 10 * 45, height: 3 * 45, widthPct: 100 });
  });
});