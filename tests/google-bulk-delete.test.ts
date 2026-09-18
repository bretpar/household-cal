import { describe, expect, it } from "vitest";

import {
  eventMatchesFilters,
  previewIdentity,
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

describe("bulk delete matching", () => {
  it("matches exact titles and known generated initials only", () => {
    expect(titleMatchesFilter("Michelle", "Michelle", ["D", "M"])).toBe(true);
    expect(titleMatchesFilter("Michelle - D & M", "Michelle", ["D", "M"])).toBe(true);
    expect(titleMatchesFilter("Michelle extra", "Michelle", ["D", "M"])).toBe(false);
    expect(titleMatchesFilter("Michelle - X", "Michelle", ["D", "M"])).toBe(false);
  });

  it("applies inclusive dates and optional exact times", () => {
    const event = {
      id: "one",
      title: "Michelle",
      date: "2026-09-17",
      start_time: "07:30",
      end_time: "17:00",
      recurring: false,
    };
    expect(eventMatchesFilters(event, filters, ["M"])).toBe(true);
    expect(eventMatchesFilters(event, { ...filters, start_time: "07:30" }, ["M"])).toBe(true);
    expect(eventMatchesFilters(event, { ...filters, start_time: "08:00" }, ["M"])).toBe(false);
  });

  it("always excludes recurring masters and instances", () => {
    expect(
      eventMatchesFilters(
        { id: "series", title: "Michelle", date: "2026-09-17", start_time: "07:30", end_time: "17:00", recurring: true },
        filters,
        ["M"],
      ),
    ).toBe(false);
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
      google_event_ids: ["google-one"],
      ofc_event_id: "one",
    };
    expect(previewIdentity([item])).toBe(previewIdentity([{ ...item, google_event_ids: ["google-one"] }]));
    expect(previewIdentity([item])).not.toBe(previewIdentity([{ ...item, google_event_ids: ["google-two"] }]));
  });
});