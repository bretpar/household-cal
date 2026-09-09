import { beforeEach, describe, expect, it, vi } from "vitest";

import { repairStaleRecurringBodies } from "../src/lib/google/sync.server";

vi.mock("@/lib/google/api.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/google/api.server")>();
  return {
    ...actual,
    getEvent: vi.fn(),
    listInstances: vi.fn(),
    patchEvent: vi.fn(),
    updateEvent: vi.fn(),
    getEventRaw: vi.fn(),
  };
});

const api = await import("@/lib/google/api.server");
const getEvent = vi.mocked(api.getEvent);
const updateEvent = vi.mocked(api.updateEvent);
const getEventRaw = vi.mocked(api.getEventRaw);

const TZ = "America/Los_Angeles";
const MASTER_ID = "k36j3eluqfajsjq3s7o8eflae4";
const FAMILY_ID = "fam-1";
const EVENT_ID = "event-1";

// Monday 4-5 PM Los Angeles weekly — the production DST case.
const eventRow = {
  id: EVENT_ID,
  family_id: FAMILY_ID,
  title: "QA-HIRISK-202609080305-T3-DST",
  start_at: "2026-10-26T23:00:00.000Z",
  end_at: "2026-10-27T00:00:00.000Z",
  all_day: false,
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261206T235959Z",
  event_members: [{ family_member_id: "dad", weekdays: null }],
};

const linkRow = {
  id: "link-1",
  branch_key: "",
  google_event_id: MASTER_ID,
  calendar_source_id: "src-1",
  google_recurring_event_id: null,
  google_original_start: null,
};

const sourceRow = {
  id: "src-1",
  family_id: FAMILY_ID,
  name: "Family",
  external_calendar_id: "family@group.calendar.google.com",
  is_main: true,
  google_sync_token: null,
  google_channel_id: null,
  google_channel_resource_id: null,
};

// Live master still carries the stale fixed-offset/UTC body.
const staleRemote = {
  id: MASTER_ID,
  status: "confirmed",
  start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
  end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261206T235959Z"],
};

type Update = { table: string; id: string; payload: Record<string, unknown> };

function makeAdmin(updates: Update[]) {
  const tableData: Record<string, unknown> = {
    events: eventRow,
    families: { timezone: TZ },
    family_members: [{ id: "dad", initial: "D", sort_order: 0 }],
    event_sync_links: [linkRow],
  };
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        maybeSingle: async () => ({ data: Array.isArray(tableData[table]) ? (tableData[table] as unknown[])[0] ?? null : tableData[table] ?? null }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ table, id, payload });
            return { error: null };
          },
        }),
        then: (resolve: (v: { data: unknown }) => unknown) =>
          resolve({ data: tableData[table] ?? null }),
      };
      return builder;
    },
  };
}

const conn = {
  connectionId: "conn-1",
  familyId: FAMILY_ID,
  connectionKey: "key-1",
  accountEmail: "dad@example.com",
};

describe("DST repair Google write failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEvent.mockResolvedValue(staleRemote as never);
    getEventRaw.mockResolvedValue(staleRemote as never);
    updateEvent.mockRejectedValue(new Error("500 Backend Error"));
  });

  it("surfaces the error and does not mark the repair complete", async () => {
    const updates: Update[] = [];
    const admin = makeAdmin(updates);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await repairStaleRecurringBodies(
      admin as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );

    // The write failed and the failure is surfaced.
    expect(result).toEqual({ repaired: 0, failed: 1 });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent.mock.calls[0]![2]).toBe(MASTER_ID);
    expect(spy).toHaveBeenCalledWith(
      "[google-sync] DST repair write failed",
      MASTER_ID,
      "500 Backend Error",
    );

    // Exactly one link update, recording the failure — never a success state.
    expect(updates).toHaveLength(1);
    const { payload } = updates[0]!;
    expect(updates[0]!.id).toBe("link-1");
    expect(payload.sync_error).toBe("dst_repair_failed: 500 Backend Error");
    expect(payload.dst_repair).toMatchObject({
      attempted: true,
      method: "update",
      success: false,
      error: "500 Backend Error",
      updated: null,
      etag: null,
    });
    // Not marked complete: no version bump / cleared error / remote timestamps.
    expect(payload.app_version).toBeUndefined();
    expect(payload.google_etag).toBeUndefined();
    expect(payload.last_pushed_at).toBeUndefined();

    // A later reconcile still sees the master as STALE and retries the write.
    const retry = await repairStaleRecurringBodies(
      admin as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );
    expect(retry).toEqual({ repaired: 0, failed: 1 });
    expect(updateEvent).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });
});
