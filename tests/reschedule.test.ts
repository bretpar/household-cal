import { describe, expect, it } from "vitest";

import { rescheduleDraft, shiftRuleWeekdays } from "../src/lib/reschedule";
import { expandOccurrences, type CalendarEvent } from "../src/lib/family-data";

function seriesEvent(): CalendarEvent {
  return {
    id: "e1",
    family_id: "f1",
    calendar_source_id: null,
    display_mode: "events",
    title: "School",
    // Mon 2026-08-24 08:00 local
    start_at: new Date(2026, 7, 24, 8, 0).toISOString(),
    end_at: new Date(2026, 7, 24, 9, 0).toISOString(),
    all_day: false,
    location: null,
    notes: null,
    event_type: "school",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH",
    recurrence_until: "2026-12-14",
    excluded_dates: [],
    external_event_id: null,
    external_recurring_event_id: null,
    participants: [
      { member_id: "b", weekdays: ["MO", "TU", "WE", "TH"] },
      { member_id: "e", weekdays: null },
    ],
    member_ids: ["b", "e"],
  };
}

describe("drag-and-drop reschedule", () => {
  it("shifts BYDAY when the drop lands on another weekday", () => {
    expect(shiftRuleWeekdays("FREQ=WEEKLY;BYDAY=MO,TH", 1)).toBe("FREQ=WEEKLY;BYDAY=TU,FR");
    expect(shiftRuleWeekdays("FREQ=WEEKLY;BYDAY=MO", 7)).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(shiftRuleWeekdays("FREQ=DAILY;INTERVAL=2", 3)).toBe("FREQ=DAILY;INTERVAL=2");
  });

  it("keeps duration and detaches a single occurrence for scope 'this'", () => {
    const event = seriesEvent();
    const [occurrence] = expandOccurrences(
      [event],
      new Date(2026, 7, 24),
      new Date(2026, 7, 24, 23, 59),
    );
    const target = new Date(2026, 7, 24, 15, 30);
    const draft = rescheduleDraft(occurrence!, target, "this");
    expect(draft.recurrence_rule).toBeNull();
    expect(draft.recurrence_until).toBeNull();
    expect(new Date(draft.start_at).getTime()).toBe(target.getTime());
    expect(new Date(draft.end_at).getTime() - new Date(draft.start_at).getTime()).toBe(3600_000);
    expect(draft.member_ids.sort()).toEqual(["b", "e"]);
  });

  it("shifts the whole series and per-person weekdays for scope 'series'", () => {
    const event = seriesEvent();
    const [occurrence] = expandOccurrences(
      [event],
      new Date(2026, 7, 25),
      new Date(2026, 7, 25, 23, 59),
    );
    // Tue 08:00 dropped on Wed 10:00 => +1 day, new time 10:00
    const draft = rescheduleDraft(occurrence!, new Date(2026, 7, 26, 10, 0), "series");
    expect(draft.recurrence_rule).toBe("FREQ=WEEKLY;BYDAY=TU,WE,TH,FR");
    expect(draft.recurrence_until).toBe("2026-12-14");
    const start = new Date(draft.start_at);
    // series anchor moved from Mon 24th 08:00 to Tue 25th 10:00
    expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([7, 25, 10]);
    expect(draft.member_weekdays).toEqual({ b: ["TU", "WE", "TH", "FR"], e: null });
  });

  it("starts a new series at the dropped moment for scope 'future'", () => {
    const event = seriesEvent();
    const [occurrence] = expandOccurrences(
      [event],
      new Date(2026, 8, 1),
      new Date(2026, 8, 1, 23, 59),
    );
    const target = new Date(2026, 8, 1, 11, 0);
    const draft = rescheduleDraft(occurrence!, target, "future");
    expect(new Date(draft.start_at).getTime()).toBe(target.getTime());
    expect(draft.recurrence_rule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH");
    expect(draft.recurrence_until).toBe("2026-12-14");
  });
});
