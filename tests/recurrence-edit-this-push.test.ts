import { describe, expect, it } from "vitest";

import { applyEventUpdate, pushTargetsForUpdate, type EventInput } from "@/lib/calendar-ops";

/**
 * Regression coverage for the "This event only" time-edit sync bug: the
 * detached one-off replacement was created locally but never pushed to Google,
 * so it had no event_sync_links row and never appeared on the calendar.
 */

interface Row {
  id: string;
  [key: string]: unknown;
}

/** Minimal in-memory stand-in for the Supabase surface used by applyEventUpdate. */
function makeDb(parent: Row) {
  const rows: Row[] = [parent];
  const members: Record<string, unknown>[] = [];
  let seq = 0;
  const db = {
    from: (table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              single: async () => {
                const row = rows.find((r) => r.id === id);
                return { data: row ? { ...row } : null, error: row ? null : { message: "no row" } };
              },
            }),
          }),
          update: (vals: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              const row = rows.find((r) => r.id === id);
              if (!row) return { error: { message: "no row" } };
              Object.assign(row, vals);
              return { error: null };
            },
          }),
          insert: (vals: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                seq += 1;
                const row = { id: `detached-${seq}`, ...vals } as Row;
                rows.push(row);
                return { data: { id: row.id }, error: null };
              },
            }),
          }),
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "event_members") {
        return {
          insert: async (vals: Record<string, unknown>[]) => {
            members.push(...vals);
            return { error: null };
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db, rows, members };
}

function parentRow(): Row {
  return {
    id: "parent-1",
    family_id: "fam-1",
    title: "Codex QA",
    start_at: "2026-10-12T14:30:00.000Z",
    end_at: "2026-10-13T00:00:00.000Z",
    all_day: false,
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE,TH",
    recurrence_until: null,
    excluded_dates: [] as string[],
    calendar_source_id: "src-1",
  };
}

/** Same event moved to 8:30 AM local on the edited Wednesday. */
const editedInput: EventInput = {
  title: "Codex QA",
  start_at: "2026-10-14T15:30:00.000Z",
  end_at: "2026-10-15T00:00:00.000Z",
  all_day: false,
  location: null,
  notes: null,
  event_type: "other",
  category_id: null,
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE,TH",
  recurrence_until: null,
  member_ids: ["m1"],
  member_weekdays: { m1: ["MO", "WE", "TH"] },
  calendar_source_id: null,
} as unknown as EventInput;

describe('"This event only" time edit', () => {
  it("excludes the day on the parent and creates a detached one-off", async () => {
    const { db, rows } = makeDb(parentRow());
    const created = await applyEventUpdate(
      db as never,
      "parent-1",
      "2026-10-14",
      "this",
      editedInput,
    );
    const parent = rows.find((r) => r.id === "parent-1")!;
    expect(parent["excluded_dates"]).toEqual(["2026-10-14"]);
    expect(parent["recurrence_rule"]).toBe("FREQ=WEEKLY;BYDAY=MO,WE,TH");
    expect(parent["start_at"]).toBe("2026-10-12T14:30:00.000Z");

    expect(created).toBe("detached-1");
    const detached = rows.find((r) => r.id === created)!;
    expect(detached["recurrence_rule"]).toBeNull();
    expect(detached["start_at"]).toBe("2026-10-14T15:30:00.000Z");
    expect(detached["calendar_source_id"]).toBe("src-1");
  });

  it("schedules a Google push for both the parent and the detached one-off", () => {
    expect(pushTargetsForUpdate("parent-1", "detached-1")).toEqual(["parent-1", "detached-1"]);
  });

  it("pushes each row exactly once even when the same operation retries", async () => {
    const pushes: string[] = [];
    const links = new Map<string, string>();
    const push = async (id: string) => {
      pushes.push(id);
      // link-keyed: an existing link patches instead of inserting a new event
      if (!links.has(id)) links.set(id, `google-${links.size + 1}`);
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      await Promise.all(pushTargetsForUpdate("parent-1", "detached-1").map(push));
    }

    expect(pushes).toEqual(["parent-1", "detached-1", "parent-1", "detached-1"]);
    expect(links.get("detached-1")).toBe("google-2");
    expect(links.size).toBe(2);
  });

  it("does not schedule a second push when no row was split off", () => {
    expect(pushTargetsForUpdate("parent-1", null)).toEqual(["parent-1"]);
    expect(pushTargetsForUpdate("parent-1", "parent-1")).toEqual(["parent-1"]);
  });
});
