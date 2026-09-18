import { describe, expect, it } from "vitest";

import {
  classifyRecurrence,
  eventMatchesFilters,
  previewIdentity,
  targetFromPreviewItem,
  targetIdentity,
  titleMatchesFilter,
  type BulkDeleteFilters,
} from "../src/lib/google/bulk-delete";

const filters: BulkDeleteFilters = {
  source_id: "babysitter",
  title: "Michelle",
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  start_time: null,
  end_time: null,
};

const event = {
  id: "one",
  title: "Michelle",
  date: "2026-09-17",
  start_time: "07:30",
  end_time: "17:00",
};

describe("bulk delete matching", () => {
  it("matches exact titles and known generated initials only", () => {
    expect(titleMatchesFilter("Michelle", "Michelle", ["D", "M"])).toBe(true);
    expect(titleMatchesFilter("Michelle - D & M", "Michelle", ["D", "M"])).toBe(true);
    expect(titleMatchesFilter("Michelle extra", "Michelle", ["D", "M"])).toBe(false);
    expect(titleMatchesFilter("Michelle - X", "Michelle", ["D", "M"])).toBe(false);
  });

  it("applies inclusive dates and optional exact times", () => {
    expect(eventMatchesFilters(event, filters, ["M"])).toBe(true);
    expect(eventMatchesFilters(event, { ...filters, start_time: "07:30" }, ["M"])).toBe(true);
    expect(eventMatchesFilters(event, { ...filters, start_time: "08:00" }, ["M"])).toBe(false);
  });

  it("treats a null end date as all future matching events", () => {
    const far = { ...event, date: "2031-01-04" };
    expect(eventMatchesFilters(far, filters, ["M"])).toBe(false);
    expect(eventMatchesFilters(far, { ...filters, end_date: null }, ["M"])).toBe(true);
    expect(
      eventMatchesFilters({ ...event, date: "2026-08-31" }, { ...filters, end_date: null }, ["M"]),
    ).toBe(false);
  });

  it("classifies standalone, detached and healthy recurring events", () => {
    expect(
      classifyRecurrence({ hasRecurrenceRule: false, recurringEventId: null, masterState: null }),
    ).toBe("standalone");
    expect(
      classifyRecurrence({ hasRecurrenceRule: false, recurringEventId: "master", masterState: "gone" }),
    ).toBe("detached");
    expect(
      classifyRecurrence({
        hasRecurrenceRule: false,
        recurringEventId: "master",
        masterState: "live_series",
      }),
    ).toBe("healthy_recurring");
    expect(
      classifyRecurrence({ hasRecurrenceRule: true, recurringEventId: null, masterState: null }),
    ).toBe("healthy_recurring");
  });

  it("keeps recurrence metadata from hiding matches before classification", () => {
    // Stale recurrence pointers no longer filter an event out of the preview.
    expect(eventMatchesFilters({ ...event, id: "stale" }, filters, ["M"])).toBe(true);
  });

  it("creates a stable identity and detects changed preview membership", () => {
    const item = {
      key: "ofc:one",
      title: "Michelle",
      date: "2026-09-17",
      start_time: "07:30",
      end_time: "17:00",
      calendar_name: "Babysitter Calendar",
      exists_in: "Both" as const,
      recurrence_status: "detached" as const,
      eligible: true,
      reason: null,
      google_event_ids: ["google-one"],
      ofc_event_id: "one",
    };
    expect(previewIdentity([item])).toBe(previewIdentity([{ ...item }]));
    expect(previewIdentity([item])).not.toBe(
      previewIdentity([{ ...item, google_event_ids: ["google-two"] }]),
    );
    expect(previewIdentity([item])).not.toBe(previewIdentity([{ ...item, eligible: false }]));
  });

  it("creates stable deletion targets from eligible detached preview rows", () => {
    const item = {
      key: "ofc:one",
      title: "Michelle",
      date: "2027-01-04",
      start_time: "07:30",
      end_time: "17:00",
      calendar_name: "Babysitter Calendar",
      exists_in: "OFC" as const,
      recurrence_status: "detached" as const,
      eligible: true,
      reason: "Detached instance of a broken series",
      google_event_ids: [] as string[],
      ofc_event_id: "one",
    };
    const target = targetFromPreviewItem(item);
    expect(target).toEqual({
      key: "ofc:one",
      title: "Michelle",
      date: "2027-01-04",
      google_event_ids: [],
      ofc_event_id: "one",
    });
    expect(targetIdentity([target])).not.toBe(
      targetIdentity([{ ...target, ofc_event_id: "different" }]),
    );
  });
});
