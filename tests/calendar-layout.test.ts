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

  it("prefers narrow columns and only collapses when width truly cannot fit", () => {
    const events = [
      occurrence("one", 9, 10),
      occurrence("two", 9, 10),
      occurrence("three", 9, 10),
    ];
    const wide = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 420 });
    const narrow = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 250 });
    const tiny = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 120 });
    expect(wide.foreground).toHaveLength(3);
    expect(wide.overflow).toHaveLength(0);
    expect(narrow.foreground).toHaveLength(3);
    expect(narrow.overflow).toHaveLength(0);
    expect(tiny.foreground).toHaveLength(2);
    expect(tiny.overflow[0]?.hidden).toHaveLength(1);
  });

  it("emits one overflow pill per group, counting each hidden event once", () => {
    const events = [
      occurrence("a", 8, 12),
      occurrence("b", 9, 13),
      occurrence("c", 10, 18),
      occurrence("d", 10, 11),
    ];
    const layout = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 120 });
    expect(layout.overflow).toHaveLength(1);
    expect(layout.overflow[0]?.hidden.map((o) => o.key)).toEqual(["c", "d"]);
  });

  it("deduplicates a hidden occurrence within its single overlap marker", () => {
    const hidden = occurrence("hidden", 10, 18);
    const layout = layoutTimedEvents({
      foreground: [
        occurrence("first", 8, 12),
        occurrence("second", 9, 13),
        hidden,
        hidden,
      ],
      coverage: [],
      areaWidth: 120,
    });
    expect(layout.overflow).toHaveLength(1);
    expect(layout.overflow[0]?.hidden.map((o) => o.key)).toEqual(["hidden"]);
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
      ["last", 0],
    ]);
  });

  it("keeps one stable overlap group for a chain of indirect overlaps", () => {
    // A overlaps B, B overlaps C, C overlaps D — but A never touches C or D.
    // The chain must stay a single cluster with stable, monotonically
    // increasing lanes rather than splitting into separate groups.
    const layout = layoutTimedEvents({
      foreground: [
        occurrence("d", 12, 14),
        occurrence("b", 10, 13),
        occurrence("a", 9, 11),
        occurrence("c", 11, 15),
      ],
      coverage: [],
      areaWidth: 420,
    });
    expect(layout.foreground).toHaveLength(4);
    expect(layout.overflow).toHaveLength(0);
    const lanes = Object.fromEntries(
      layout.foreground.map((item) => [item.occurrence.key, item.lane]),
    );
    expect(new Set(layout.foreground.map((item) => item.cluster)).size).toBe(1);
    expect(lanes).toEqual({ a: 0, b: 1, c: 0, d: 2 });
  });

  it("gives identical start times stable lanes ordered by duration then key", () => {
    const layout = layoutTimedEvents({
      foreground: [
        occurrence("b-short", 9, 10),
        occurrence("a-short", 9, 10),
        occurrence("z-long", 9, 12),
      ],
      coverage: [],
      areaWidth: 420,
    });
    expect(layout.foreground.map((item) => [item.occurrence.key, item.lane])).toEqual([
      ["z-long", 0],
      ["a-short", 1],
      ["b-short", 2],
    ]);
    // Every card keeps the same left/width for its full duration.
    for (const item of layout.foreground) {
      expect(item.widthPct).toBeCloseTo(100 / 3);
      expect(item.leftPct).toBeCloseTo((item.lane * 100) / 3);
    }
  });

  it("keeps a long-duration event in one segment with its true geometry", () => {
    const layout = layoutTimedEvents({
      foreground: [
        occurrence("long", 8, 20),
        occurrence("morning", 9, 10),
        occurrence("evening", 18, 19),
      ],
      coverage: [],
      areaWidth: 420,
    });
    const long = layout.foreground.find((item) => item.occurrence.key === "long");
    expect(long).toMatchObject({
      lane: 0,
      startsEvent: true,
      endsEvent: true,
      top: 8 * 45,
      height: 12 * 45,
    });
    // The long event never splits into multiple segments.
    expect(
      layout.foreground.filter((item) => item.occurrence.key === "long"),
    ).toHaveLength(1);
  });

  it("counts each hidden event once even when hidden for part of a long group", () => {
    // Narrow width forces hidden lanes; a late event that only overlaps the
    // tail of the group must still appear exactly once in the single pill.
    const events = [
      occurrence("a", 8, 18),
      occurrence("b", 9, 17),
      occurrence("c", 10, 16),
      occurrence("late", 15, 19),
    ];
    const layout = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 120 });
    expect(layout.overflow).toHaveLength(1);
    const hiddenKeys = layout.overflow[0]?.hidden.map((o) => o.key) ?? [];
    expect(new Set(hiddenKeys).size).toBe(hiddenKeys.length);
    expect(hiddenKeys).toContain("late");
  });

  it("produces no overflow when every chained event fits the width", () => {
    const events = [
      occurrence("a", 9, 11),
      occurrence("b", 10, 12),
      occurrence("c", 11, 13),
      occurrence("d", 12, 14),
    ];
    const layout = layoutTimedEvents({ foreground: events, coverage: [], areaWidth: 420 });
    expect(layout.foreground).toHaveLength(4);
    expect(layout.overflow).toHaveLength(0);
  });
});