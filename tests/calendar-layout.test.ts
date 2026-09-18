import { describe, expect, it } from "vitest";

import { layoutTimedEvents } from "@/lib/calendar-layout";
import type { CalendarEvent, Occurrence } from "@/lib/family-data";

function occurrence(key: string, startHour: number, endHour: number): Occurrence {
  const atHour = (hour: number) => {
    const date = new Date(2026, 8, 17, 0, 0, 0, 0);
    date.setMinutes(hour * 60);
    return date;
  };
  const event: CalendarEvent = {
    id: key,
    family_id: "family",
    calendar_source_id: null,
    display_mode: "events",
    title: key,
    start_at: atHour(startHour).toISOString(),
    end_at: atHour(endHour).toISOString(),
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
    start: atHour(startHour),
    end: atHour(endHour),
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
      foreground: [occurrence("short", 9, 10), occurrence("long", 9, 11)],
      coverage: [],
      areaWidth: 150,
    });
    expect(layout.foreground.map((item) => [item.occurrence.key, item.lane, item.leftPct])).toEqual([
      ["long", 0, 0],
      ["short", 1, 50],
    ]);
    expect(layout.overflow).toHaveLength(0);
  });

  it("uses the stable key after equal start times and durations", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("z-event", 9, 10), occurrence("a-event", 9, 10)],
      coverage: [],
      areaWidth: 300,
    });
    expect(layout.foreground.map((item) => [item.occurrence.key, item.lane])).toEqual([
      ["a-event", 0],
      ["z-event", 1],
    ]);
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
    expect(narrow.overflow[0]?.hidden).toHaveLength(1);
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

  it("keeps a long event in its original lane and width after an overlap ends", () => {
    const layout = layoutTimedEvents({
      foreground: [occurrence("little-gym", 9, 10), occurrence("kids-place", 9, 13)],
      coverage: [],
      areaWidth: 320,
    });
    const kidsPlace = layout.foreground.find((item) => item.occurrence.key === "kids-place");
    const littleGym = layout.foreground.find((item) => item.occurrence.key === "little-gym");
    expect(kidsPlace).toMatchObject({ lane: 0, top: 9 * 45, height: 4 * 45, widthPct: 50 });
    expect(littleGym).toMatchObject({ lane: 1, top: 9 * 45, height: 45, widthPct: 50 });
  });

  it("keeps later overlapping events to the right instead of reclaiming freed left lanes", () => {
    const layout = layoutTimedEvents({
      foreground: [
        occurrence("first", 9, 10),
        occurrence("middle", 9.5, 11),
        occurrence("last", 10, 12),
      ],
      coverage: [],
      areaWidth: 420,
    });
    expect(layout.foreground.map((item) => [item.occurrence.key, item.lane])).toEqual([
      ["first", 0],
      ["middle", 1],
      ["last", 2],
    ]);
  });
});