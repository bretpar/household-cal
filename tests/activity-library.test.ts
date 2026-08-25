import { describe, expect, it } from "vitest";

import {
  buildSeriesList,
  frequencyLabel,
  groupSeries,
  nextOccurrenceOf,
  sortSeries,
  weekdaysForSeries,
} from "../src/lib/activity-library";
import type { CalendarEvent, FamilyMember } from "../src/lib/family-data";

const NOW = new Date("2026-09-07T08:00:00"); // a Monday

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const memberIds = over.member_ids ?? [];
  return {
    id: over.id ?? "e1",
    family_id: "f1",
    calendar_source_id: null,
    display_mode: "events",
    title: "Soccer",
    start_at: "2026-09-07T16:00:00",
    end_at: "2026-09-07T17:00:00",
    all_day: false,
    location: null,
    notes: null,
    event_type: "activity",
    recurrence_rule: "FREQ=WEEKLY",
    recurrence_until: null,
    excluded_dates: [],
    external_event_id: null,
    external_recurring_event_id: null,
    participants: memberIds.map((member_id) => ({ member_id, weekdays: null })),
    member_ids: memberIds,
    needs_family_assignment: false,
    created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

const members: FamilyMember[] = [
  {
    id: "b",
    family_id: "f1",
    name: "Bailey",
    initial: "B",
    color: "sky",
    role: "child",
    access: "view_only",
    active: true,
    sort_order: 0,
  },
  {
    id: "e",
    family_id: "f1",
    name: "Ellison",
    initial: "E",
    color: "rose",
    role: "child",
    access: "view_only",
    active: true,
    sort_order: 1,
  },
];

describe("activities data source", () => {
  it("includes recurring series and excludes one-time events", () => {
    const list = buildSeriesList(
      [ev({ id: "series" }), ev({ id: "single", recurrence_rule: null })],
      NOW,
    );
    expect(list.map((s) => s.event.id)).toEqual(["series"]);
  });

  it("keeps ended series but flags them", () => {
    const list = buildSeriesList(
      [ev({ id: "past", recurrence_until: "2026-06-01" }), ev({ id: "live" })],
      NOW,
    );
    const past = list.find((s) => s.event.id === "past")!;
    const live = list.find((s) => s.event.id === "live")!;
    expect(past.ended).toBe(true);
    expect(past.nextOccurrence).toBeNull();
    expect(live.ended).toBe(false);
    expect(live.nextOccurrence).not.toBeNull();
  });

  it("respects occurrence-count recurrence", () => {
    const counted = ev({ recurrence_rule: "FREQ=WEEKLY;COUNT=1" });
    expect(nextOccurrenceOf(counted, new Date("2026-09-20T00:00:00"))).toBeNull();
  });

  it("surfaces google-imported and needs-assignment series", () => {
    const [google] = buildSeriesList(
      [
        ev({
          id: "g",
          external_event_id: "abc",
          member_ids: [],
          participants: [],
          needs_family_assignment: true,
        }),
      ],
      NOW,
    );
    expect(google!.event.needs_family_assignment).toBe(true);
    expect(google!.event.external_event_id).toBe("abc");
  });

  it("derives weekdays from BYDAY and from per-person rules", () => {
    expect(weekdaysForSeries(ev({ recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE" }))).toEqual([
      "MO",
      "WE",
    ]);
    const perPerson = ev({
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH",
      member_ids: ["b", "e"],
      participants: [
        { member_id: "b", weekdays: ["MO", "TU", "WE", "TH"] },
        { member_id: "e", weekdays: ["TU", "TH"] },
      ],
    });
    const [series] = buildSeriesList([perPerson], NOW);
    expect(series!.perPersonDays).toHaveLength(2);
    expect(series!.weekdays).toEqual(["MO", "TU", "WE", "TH"]);
  });

  it("treats a 'this and future' split as two real series", () => {
    const list = buildSeriesList(
      [
        ev({ id: "old", recurrence_until: "2026-10-01" }),
        ev({ id: "new", start_at: "2026-10-05T17:00:00", end_at: "2026-10-05T18:00:00" }),
      ],
      NOW,
    );
    expect(list).toHaveLength(2);
  });

  it("labels frequency from the rule", () => {
    expect(frequencyLabel(ev())).toBe("Weekly");
    expect(frequencyLabel(ev({ recurrence_rule: "FREQ=WEEKLY;INTERVAL=2" }))).toBe("Every 2 weeks");
    expect(frequencyLabel(ev({ recurrence_rule: "FREQ=DAILY" }))).toBe("Daily");
    expect(frequencyLabel(ev({ recurrence_rule: "FREQ=MONTHLY" }))).toBe("Monthly");
  });
});

describe("grouping and sorting", () => {
  const list = buildSeriesList(
    [
      ev({ id: "school", title: "School", event_type: "school", member_ids: ["b", "e"] }),
      ev({
        id: "soccer",
        title: "Aikido",
        event_type: "activity",
        member_ids: ["b"],
        recurrence_rule: "FREQ=WEEKLY;BYDAY=TU",
      }),
      ev({ id: "sitter", title: "Sitter", event_type: "childcare", member_ids: [] }),
    ],
    NOW,
  );

  it("groups by category with plural sections", () => {
    const groups = groupSeries(list, "category", "name", members);
    expect(groups.map((g) => g.label)).toEqual(["School", "Activities", "Childcare"]);
  });

  it("groups by family member and buckets unassigned series", () => {
    const groups = groupSeries(list, "member", "name", members);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Bailey");
    expect(labels).toContain("Ellison");
    expect(labels).toContain("Needs family assignment");
    expect(groups.find((g) => g.label === "Bailey")!.items).toHaveLength(2);
  });

  it("groups by day of week", () => {
    const groups = groupSeries(list, "day", "name", members);
    expect(groups.find((g) => g.label === "Tuesday")!.items.map((i) => i.event.title)).toEqual([
      "Aikido",
    ]);
  });

  it("sorts by name", () => {
    const groups = groupSeries(list, "none", "name", members);
    expect(groups[0]!.items.map((i) => i.event.title)).toEqual(["Aikido", "School", "Sitter"]);
  });

  it("sorts ended series last when sorting by next occurrence", () => {
    const withEnded = buildSeriesList(
      [ev({ id: "a", title: "Ended", recurrence_until: "2026-01-01" }), ev({ id: "b" })],
      NOW,
    );
    expect(sortSeries(withEnded, "next").map((s) => s.event.id)).toEqual(["b", "a"]);
  });

  it("sorts recently added first", () => {
    const items = buildSeriesList(
      [
        ev({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
        ev({ id: "fresh", created_at: "2026-08-20T00:00:00Z" }),
      ],
      NOW,
    );
    expect(sortSeries(items, "created").map((s) => s.event.id)).toEqual(["fresh", "old"]);
  });
});
