import { describe, expect, it } from "vitest";

import { stateForSeriesScope } from "@/components/EventForm";
import type { EventFormState } from "@/components/EventForm";
import type { Occurrence } from "@/lib/family-data";

/**
 * Whole-series edits must never re-anchor the parent series to the clicked
 * occurrence (the Oct–Nov series edited from Nov 21 bug). Only an explicitly
 * changed date may move the series start.
 */

function occurrence(overrides: {
  seriesStart: string; // parent start_at ISO
  occurrenceStart: string; // clicked occurrence local time
  rule?: string | null;
}): Occurrence {
  const start = new Date(overrides.occurrenceStart);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    event: {
      id: "evt-1",
      recurrence_rule: overrides.rule === undefined ? "FREQ=WEEKLY" : overrides.rule,
      start_at: overrides.seriesStart,
    },
    start,
    end,
  } as unknown as Occurrence;
}

function state(date: string): EventFormState {
  return { date, startTime: "09:00", endTime: "10:00" } as EventFormState;
}

describe("stateForSeriesScope", () => {
  it("keeps the parent start date when the form still shows the occurrence day", () => {
    // Series anchored Oct 3 (Sat); user opened the Nov 21 occurrence and only
    // changed the time. The saved date must stay Oct 3, not Nov 21.
    const occ = occurrence({
      seriesStart: new Date("2026-10-03T09:00:00").toISOString(),
      occurrenceStart: "2026-11-21T09:00:00",
    });
    const next = stateForSeriesScope(state("2026-11-21"), occ);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(next.date).toBe(fmt(new Date(occ.event.start_at)));
    expect(next.startTime).toBe("09:00");
  });

  it("uses an explicitly changed date as the new series anchor", () => {
    const occ = occurrence({
      seriesStart: new Date("2026-10-03T09:00:00").toISOString(),
      occurrenceStart: "2026-11-21T09:00:00",
    });
    // User picked a different day than the occurrence — deliberate re-anchor.
    const next = stateForSeriesScope(state("2026-11-24"), occ);
    expect(next.date).toBe("2026-11-24");
  });

  it("is a no-op for the series' own first occurrence", () => {
    const first = new Date("2026-10-03T09:00:00");
    const occ = occurrence({
      seriesStart: first.toISOString(),
      occurrenceStart: "2026-10-03T09:00:00",
    });
    const next = stateForSeriesScope(state("2026-10-03"), occ);
    expect(next.date).toBe("2026-10-03");
  });

  it("is a no-op for non-recurring events", () => {
    const occ = occurrence({
      seriesStart: new Date("2026-10-03T09:00:00").toISOString(),
      occurrenceStart: "2026-10-03T09:00:00",
      rule: null,
    });
    const next = stateForSeriesScope(state("2026-10-03"), occ);
    expect(next.date).toBe("2026-10-03");
  });
});
