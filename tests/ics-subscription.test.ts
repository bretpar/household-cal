import { describe, expect, it } from "vitest";

import { icsExternalId, parseIcs, parseIcsDuration, withinWindow } from "@/lib/ics/parse";
import { normalizeSubscriptionUrl, planIcsImport, subscriptionHint } from "@/lib/ics/import.server";

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:timed-1
SUMMARY:Dentist
LOCATION:Main St
DTSTART;TZID=America/Los_Angeles:20260920T083000
DTEND;TZID=America/Los_Angeles:20260920T093000
END:VEVENT
BEGIN:VEVENT
UID:allday-1
SUMMARY:School holi
 day
DTSTART;VALUE=DATE:20260921
DTEND;VALUE=DATE:20260922
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
SUMMARY:Swim
DTSTART:20260922T160000Z
DURATION:PT45M
RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261124T160000Z;X-IGNORED=1
EXDATE:20261006T160000Z
BEGIN:VALARM
TRIGGER:-PT15M
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID:20261013T160000Z
SUMMARY:Swim (late)
DTSTART:20261013T170000Z
DTEND:20261013T174500Z
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
SUMMARY:Gone
STATUS:CANCELLED
DTSTART:20260925T160000Z
DTEND:20260925T170000Z
END:VEVENT
END:VCALENDAR`;

describe("ICS parsing", () => {
  const events = parseIcs(FEED, "America/Los_Angeles");

  it("reads a zoned timed event as the right instant", () => {
    const timed = events.find((e) => e.uid === "timed-1")!;
    expect(timed.allDay).toBe(false);
    // 8:30 AM Los Angeles in September = 15:30 UTC
    expect(timed.startAt).toBe("2026-09-20T15:30:00.000Z");
    expect(timed.endAt).toBe("2026-09-20T16:30:00.000Z");
    expect(timed.location).toBe("Main St");
  });

  it("unfolds wrapped lines and makes all-day end dates inclusive", () => {
    const allDay = events.find((e) => e.uid === "allday-1")!;
    expect(allDay.title).toBe("School holiday");
    expect(allDay.allDay).toBe(true);
    expect(allDay.startAt.slice(0, 10)).toBe("2026-09-21");
    expect(allDay.endAt.slice(0, 10)).toBe("2026-09-21");
  });

  it("keeps supported repeat parts, UNTIL and skipped days, ignoring alarms", () => {
    const weekly = events.find((e) => e.uid === "weekly-1" && !e.recurrenceId)!;
    expect(weekly.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261124T160000Z");
    expect(weekly.recurrenceUntil).toBe("2026-11-24");
    expect(weekly.excludedDates).toEqual(["2026-10-06"]);
    // DURATION drives the end when DTEND is absent
    expect(weekly.endAt).toBe("2026-09-22T16:45:00.000Z");
  });

  it("gives a changed occurrence its own stable identifier", () => {
    const detached = events.find((e) => e.recurrenceId)!;
    expect(icsExternalId(detached)).toBe("weekly-1::20261013T160000Z");
    expect(icsExternalId({ uid: "weekly-1", recurrenceId: null })).toBe("weekly-1");
  });

  it("marks cancelled events", () => {
    expect(events.find((e) => e.uid === "cancelled-1")!.cancelled).toBe(true);
  });

  it("parses durations", () => {
    expect(parseIcsDuration("P1DT2H30M")).toBe(95400000);
    expect(parseIcsDuration("nope")).toBeNull();
  });

  it("keeps repeating series and drops one-offs outside the window", () => {
    const window = { from: "2026-09-19T00:00:00.000Z", to: "2027-09-19T00:00:00.000Z" };
    expect(withinWindow(events.find((e) => e.uid === "weekly-1")!, window)).toBe(true);
    expect(withinWindow(events.find((e) => e.uid === "timed-1")!, window)).toBe(true);
    expect(
      withinWindow(events.find((e) => e.uid === "timed-1")!, {
        from: "2027-01-01T00:00:00.000Z",
        to: "2027-02-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("import diff", () => {
  const events = parseIcs(FEED, "UTC");
  const window = { from: "2026-09-01T00:00:00.000Z", to: "2027-09-01T00:00:00.000Z" };

  it("creates new rows, updates matches, and never duplicates on a second run", () => {
    const first = planIcsImport(events, [], window);
    expect(first.create).toHaveLength(4); // cancelled one excluded
    expect(first.update).toHaveLength(0);
    expect(first.deleteIds).toHaveLength(0);

    const existing = first.create.map((row, index) => ({
      id: `row-${index}`,
      external_event_id: row.external_event_id,
    }));
    const second = planIcsImport(events, existing, window);
    expect(second.create).toHaveLength(0);
    expect(second.update).toHaveLength(4);
    expect(second.deleteIds).toHaveLength(0);
  });

  it("removes rows whose feed event disappeared, plus stray duplicates", () => {
    const plan = planIcsImport(events, [
      { id: "keep", external_event_id: "timed-1" },
      { id: "dupe", external_event_id: "timed-1" },
      { id: "gone", external_event_id: "deleted-in-apple" },
      { id: "orphan", external_event_id: null },
    ], window);
    expect(plan.update.map((u) => u.id)).toEqual(["keep"]);
    expect(plan.deleteIds.sort()).toEqual(["dupe", "gone", "orphan"]);
  });
});

describe("subscription links", () => {
  it("accepts webcal links and never exposes the full URL", () => {
    const url = normalizeSubscriptionUrl(" webcal://p01-caldav.icloud.com/published/2/abcdef123456 ");
    expect(url.startsWith("https://p01-caldav.icloud.com/")).toBe(true);
    const hint = subscriptionHint(url);
    expect(hint).toBe("p01-caldav.icloud.com/…123456");
    expect(hint.includes("abcdef")).toBe(false);
  });

  it("rejects values that are not links", () => {
    expect(() => normalizeSubscriptionUrl("not a link")).toThrow();
    expect(() => normalizeSubscriptionUrl("")).toThrow();
  });
});
