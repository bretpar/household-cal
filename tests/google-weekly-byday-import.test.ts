import { describe, expect, it } from "vitest";

import {
  fromGoogleRecurrence,
  localRuleFromGoogle,
  seriesPatchFromGoogle,
} from "../src/lib/google/mapping";
import { expandOccurrences } from "../src/lib/family-data";
import type { CalendarEvent } from "../src/lib/family-data";

describe("Google weekly BYDAY import", () => {
  const recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=WE,TH"];

  it("keeps BYDAY in the stored local rule", () => {
    const rec = fromGoogleRecurrence(recurrence);
    expect(rec.weekdays).toEqual(["WE", "TH"]);
    expect(localRuleFromGoogle(rec)).toBe("FREQ=WEEKLY;BYDAY=WE,TH");
  });

  it("keeps BYDAY when updating an existing series", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Practice", memberCount: 1, branchKey: "" },
      branchInitials: ["B"],
      google: {
        id: "g1",
        summary: "Practice - B",
        start: { dateTime: "2026-09-02T17:00:00.000Z" },
        end: { dateTime: "2026-09-02T18:00:00.000Z" },
        recurrence,
      } as never,
    });
    expect(patch["recurrence_rule"]).toBe("FREQ=WEEKLY;BYDAY=WE,TH");
  });

  it("does not duplicate an existing BYDAY", () => {
    expect(localRuleFromGoogle({ rule: "FREQ=WEEKLY;BYDAY=MO", weekdays: ["WE"] })).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
    expect(localRuleFromGoogle({ rule: "FREQ=WEEKLY;INTERVAL=2", weekdays: ["WE", "TH"] })).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,TH",
    );
  });

  it("expands to both Sep 2 and Sep 3, 2026", () => {
    const rule = localRuleFromGoogle(fromGoogleRecurrence(recurrence));
    const event = {
      id: "e1",
      family_id: "f1",
      calendar_source_id: "s1",
      display_mode: "events",
      title: "Practice",
      start_at: new Date(2026, 8, 2, 10, 0).toISOString(),
      end_at: new Date(2026, 8, 2, 11, 0).toISOString(),
      all_day: false,
      location: null,
      notes: null,
      event_type: "other",
      category_id: null,
      recurrence_rule: rule,
      recurrence_until: null,
      excluded_dates: [],
      participants: [],
      member_ids: [],
    } as unknown as CalendarEvent;

    const days = expandOccurrences(
      [event],
      new Date(2026, 8, 1),
      new Date(2026, 8, 5),
    ).map((o) => o.start.getDate());
    expect(days).toContain(2);
    expect(days).toContain(3);
  });
});
