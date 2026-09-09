import { beforeEach, describe, expect, it, vi } from "vitest";

import { repairStaleRecurringBodies } from "../src/lib/google/sync.server";

vi.mock("@/lib/google/api.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/google/api.server")>();
  return {
    ...actual,
    getEvent: vi.fn(),
    getEventRaw: vi.fn(),
    listInstances: vi.fn(),
    patchEvent: vi.fn(),
    updateEvent: vi.fn(),
  };
});

const api = await import("@/lib/google/api.server");
const getEvent = vi.mocked(api.getEvent);
const getEventRaw = vi.mocked(api.getEventRaw);
const patchEvent = vi.mocked(api.patchEvent);
const updateEvent = vi.mocked(api.updateEvent);

const TZ = "America/Los_Angeles";
const MASTER_ID = "k36j3eluqfajsjq3s7o8eflae4";
const FAMILY_ID = "fam-1";
const EVENT_ID = "event-1";

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

/**
 * Stale fixed-offset master: the first instant matches the intended one, so a
 * PATCH is a semantic no-op for Google while post-DST expansion stays wrong.
 */
const staleRemote = {
  id: MASTER_ID,
  status: "confirmed",
  summary: "QA-HIRISK-202609080305-T3-DST - D",
  description: "babysitter shift",
  location: "Home",
  reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  visibility: "private",
  transparency: "opaque",
  colorId: "5",
  attendees: [{ email: "mom@example.com" }],
  extendedProperties: { private: { ofcEventId: EVENT_ID } },
  etag: "etag-old",
  updated: "2026-09-01T00:00:00.000Z",
  start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
  end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
};

/** What Google reports after the corrective full update. */
const healthyRemote = {
  ...staleRemote,
  etag: "etag-new",
  updated: "2026-09-09T15:00:00.000Z",
  start: { dateTime: "2026-10-26T16:00:00", timeZone: TZ },
  end: { dateTime: "2026-10-26T17:00:00", timeZone: TZ },
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
        maybeSingle: async () => ({
          data: Array.isArray(tableData[table])
            ? ((tableData[table] as unknown[])[0] ?? null)
            : (tableData[table] ?? null),
        }),
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

describe("DST repair uses a full update on the same Google master", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEvent.mockResolvedValue(staleRemote as never);
    getEventRaw.mockResolvedValue(staleRemote as never);
    updateEvent.mockResolvedValue({
      id: MASTER_ID,
      etag: "etag-new",
      updated: "2026-09-09T15:00:00.000Z",
    } as never);
  });

  it("PUTs the corrected body, preserves metadata, and is not repeated once healthy", async () => {
    const updates: Update[] = [];
    const admin = makeAdmin(updates);

    const result = await repairStaleRecurringBodies(
      admin as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );
    expect(result).toEqual({ repaired: 1, failed: 0 });

    // Full update, not patch, on the SAME Google master.
    expect(patchEvent).not.toHaveBeenCalled();
    expect(updateEvent).toHaveBeenCalledTimes(1);
    const [, calendarId, googleId, body] = updateEvent.mock.calls[0]! as unknown as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(calendarId).toBe(sourceRow.external_calendar_id);
    expect(googleId).toBe(MASTER_ID);

    // Corrected DST-safe wall clock + IANA zone and recurrence.
    expect(body["start"]).toEqual({ dateTime: "2026-10-26T16:00:00", timeZone: TZ });
    expect(body["end"]).toEqual({ dateTime: "2026-10-26T17:00:00", timeZone: TZ });
    expect(body["recurrence"]).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);

    // Existing writable metadata preserved.
    expect(body["description"]).toBe("babysitter shift");
    expect(body["location"]).toBe("Home");
    expect(body["reminders"]).toEqual(staleRemote.reminders);
    expect(body["visibility"]).toBe("private");
    expect(body["transparency"]).toBe("opaque");
    expect(body["colorId"]).toBe("5");
    expect(body["attendees"]).toEqual(staleRemote.attendees);
    expect(body["extendedProperties"]).toEqual(staleRemote.extendedProperties);

    // Link keeps its identity and records the returned Google state.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("link-1");
    expect(updates[0]!.payload.dst_repair).toMatchObject({
      attempted: true,
      method: "update",
      success: true,
      updated: "2026-09-09T15:00:00.000Z",
      etag: "etag-new",
    });

    // Second pass: Google now returns the healthy body — no further write.
    getEvent.mockResolvedValue(healthyRemote as never);
    getEventRaw.mockResolvedValue(healthyRemote as never);
    const second = await repairStaleRecurringBodies(
      admin as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );
    expect(second).toEqual({ repaired: 0, failed: 0 });
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });
});
