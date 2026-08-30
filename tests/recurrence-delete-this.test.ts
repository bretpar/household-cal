import { describe, expect, it } from "vitest";

import { applyEventDelete } from "@/lib/calendar-ops";
import { expandOccurrences, type CalendarEvent } from "@/lib/family-data";

/**
 * Regression coverage for the recurring "Delete this event only" bug:
 * deleting a generated occurrence must append that day to the recurring
 * parent's excluded_dates exactly once — even when a concurrent write
 * clobbers the first append.
 */

interface Row {
  id: string;
  recurrence_rule: string | null;
  excluded_dates: string[];
  [key: string]: unknown;
}

/** Minimal in-memory stand-in for the Supabase client surface used here. */
function makeDb(row: Row, hooks?: { afterUpdate?: (snapshot: Row) => void }) {
  return {
    from: (table: string) => {
      if (table !== "events") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            single: async () => ({
              data: id === row.id ? { ...row, excluded_dates: [...row.excluded_dates] } : null,
              error: id === row.id ? null : { message: "not found" },
            }),
          }),
        }),
        update: (vals: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            if (id !== row.id) return { error: { message: "not found" } };
            Object.assign(row, vals);
            hooks?.afterUpdate?.(row);
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    },
  };
}

function parentRow(excluded: string[] = []): Row {
  return {
    id: "parent-1",
    family_id: "fam-1",
    title: "Michelle",
    start_at: "2026-09-02T14:30:00.000Z",
    end_at: "2026-09-03T00:00:00.000Z",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE,TH",
    recurrence_until: null,
    excluded_dates: excluded,
  };
}

/** CalendarEvent view of the row for local occurrence expansion. */
function asEvent(row: Row): CalendarEvent {
  return {
    ...row,
    participants: [],
    member_ids: [],
  } as unknown as CalendarEvent;
}

function occurrenceDays(event: CalendarEvent, from: string, to: string): string[] {
  return expandOccurrences(event ? [event] : [], new Date(from), new Date(to)).map(
    (o) =>
      `${o.start.getFullYear()}-${String(o.start.getMonth() + 1).padStart(2, "0")}-${String(o.start.getDate()).padStart(2, "0")}`,
  );
}

describe("applyEventDelete scope=this", () => {
  it("appends the clicked Wednesday to the recurring parent's excluded_dates", async () => {
    const row = parentRow();
    await applyEventDelete(makeDb(row) as never, "parent-1", "2026-09-16", "this");
    expect(row.excluded_dates).toEqual(["2026-09-16"]);
    // Parent series fields untouched.
    expect(row.recurrence_rule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,TH");
    expect(row.start_at).toBe("2026-09-02T14:30:00.000Z");
    expect(row.end_at).toBe("2026-09-03T00:00:00.000Z");
    expect(row.recurrence_until).toBeNull();
  });

  it("keeps surrounding Mon/Wed/Thu occurrences after the exclusion", async () => {
    const row = parentRow();
    await applyEventDelete(makeDb(row) as never, "parent-1", "2026-09-16", "this");
    const days = occurrenceDays(asEvent(row), "2026-09-14T00:00:00", "2026-09-19T00:00:00");
    expect(days).toEqual(["2026-09-14", "2026-09-17"]);
  });

  it("does not duplicate excluded_dates on repeated delete of the same day", async () => {
    const row = parentRow(["2026-09-16"]);
    await applyEventDelete(makeDb(row) as never, "parent-1", "2026-09-16", "this");
    expect(row.excluded_dates).toEqual(["2026-09-16"]);
  });

  it("recovers when a concurrent writer clobbers the first append", async () => {
    const row = parentRow(["2026-09-09"]);
    let clobbered = false;
    const db = makeDb(row, {
      afterUpdate: (snapshot) => {
        // Simulate the Sep 23 delete racing us: its stale read-modify-write
        // overwrites our just-written array with its own merge.
        if (!clobbered) {
          clobbered = true;
          snapshot.excluded_dates = ["2026-09-09", "2026-09-23"];
        }
      },
    });
    await applyEventDelete(db as never, "parent-1", "2026-09-16", "this");
    expect(row.excluded_dates).toContain("2026-09-16");
    expect(row.excluded_dates).toContain("2026-09-23");
    expect(row.excluded_dates).toContain("2026-09-09");
    expect(row.excluded_dates).toHaveLength(3);
  });
});
