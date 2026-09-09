import { beforeEach, describe, expect, it, vi } from "vitest";

import { repairStaleRecurringBodies } from "../src/lib/google/sync.server";

/**
 * Integration coverage for the DST repair path: it runs through the REAL
 * `api.server` layer (only the connector transport is mocked) so the actual
 * HTTP method reaching Google is asserted. Stale masters must be repaired with
 * `updateEvent()` (PUT) and must never fall back to `events.patch`.
 */
vi.mock("@/integrations/lovable/appUserConnector", () => ({
  callAsAppUser: vi.fn(),
}));

const connector = await import("@/integrations/lovable/appUserConnector");
const callAsAppUser = vi.mocked(connector.callAsAppUser);

const TZ = "America/Los_Angeles";
const MASTER_ID = "k36j3eluqfajsjq3s7o8eflae4";
const MOM_MASTER_ID = "mombranchmaster0000000000";
const FAMILY_ID = "fam-1";
const EVENT_ID = "event-1";

const eventRow = {
  id: EVENT_ID,
  family_id: FAMILY_ID,
  title: "QA-PUTONLY-202609091200",
  start_at: "2026-10-26T23:00:00.000Z",
  end_at: "2026-10-27T00:00:00.000Z",
  all_day: false,
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261206T235959Z",
  event_members: [
    { family_member_id: "dad", weekdays: ["MO"] },
    { family_member_id: "mom", weekdays: ["WE"] },
  ],
};

const links = [
  {
    id: "link-dad",
    branch_key: "dad",
    google_event_id: MASTER_ID,
    calendar_source_id: "src-1",
    google_recurring_event_id: null,
    google_original_start: null,
  },
  {
    id: "link-mom",
    branch_key: "mom",
    google_event_id: MOM_MASTER_ID,
    calendar_source_id: "src-1",
    google_recurring_event_id: null,
    google_original_start: null,
  },
];

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

/** Fixed-offset master: same first instant, wrong post-DST expansion. */
function staleRemote(id: string, summary: string) {
  return {
    id,
    status: "confirmed",
    summary,
    description: "babysitter shift",
    location: "Home",
    etag: "etag-old",
    updated: "2026-09-01T00:00:00.000Z",
    start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
    end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  };
}

type Update = { table: string; id: string; payload: Record<string, unknown> };

function makeAdmin(updates: Update[]) {
  const tableData: Record<string, unknown> = {
    events: eventRow,
    families: { timezone: TZ },
    family_members: [
      { id: "dad", initial: "D", sort_order: 0 },
      { id: "mom", initial: "M", sort_order: 1 },
    ],
    event_sync_links: links,
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

type Call = { method: string; url: string; body: unknown };

/** Records every gateway call and answers Google reads/writes. */
function transport(calls: Call[], options?: { failWrites?: boolean }) {
  callAsAppUser.mockImplementation((async (params: {
    path: string;
    init?: RequestInit;
  }) => {
    const method = (params.init?.method ?? "GET").toUpperCase();
    const rawBody = params.init?.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : null;
    calls.push({ method, url: params.path, body });

    const id = params.path.includes(encodeURIComponent(MOM_MASTER_ID))
      ? MOM_MASTER_ID
      : MASTER_ID;

    if (method === "GET") {
      if (params.path.includes("/instances")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify(staleRemote(id, "QA-PUTONLY-202609091200")),
        { status: 200 },
      );
    }
    if (options?.failWrites) {
      return new Response(JSON.stringify({ error: { message: "backend error" } }), {
        status: 500,
      });
    }
    return new Response(
      JSON.stringify({ id, etag: "etag-new", updated: "2026-09-09T15:00:00.000Z" }),
      { status: 200 },
    );
  }) as never);
}

describe("DST repair writes with PUT and never patches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues PUT on each stale master and no PATCH request at all", async () => {
    const calls: Call[] = [];
    const updates: Update[] = [];
    transport(calls);

    const result = await repairStaleRecurringBodies(
      makeAdmin(updates) as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );

    expect(result.failed).toBe(0);
    expect(result.repaired).toBeGreaterThan(0);

    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.length).toBe(result.repaired);
    expect(writes.every((c) => c.method === "PUT")).toBe(true);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    for (const write of writes) {
      // Same master targeted, DST-safe body.
      expect(
        write.url.includes(encodeURIComponent(MASTER_ID)) ||
          write.url.includes(encodeURIComponent(MOM_MASTER_ID)),
      ).toBe(true);
      const body = write.body as Record<string, Record<string, string>>;
      expect(body["start"]!["timeZone"]).toBe(TZ);
      expect(body["end"]!["timeZone"]).toBe(TZ);
      expect(body["start"]!["dateTime"]).not.toMatch(/[+-]\d{2}:\d{2}$/);
    }

    // Every repaired link records the full-update method.
    for (const update of updates) {
      expect(update.payload.dst_repair).toMatchObject({ method: "update" });
    }
  });

  it("surfaces a failed PUT without retrying via PATCH", async () => {
    const calls: Call[] = [];
    const updates: Update[] = [];
    transport(calls, { failWrites: true });

    const result = await repairStaleRecurringBodies(
      makeAdmin(updates) as never,
      conn,
      FAMILY_ID,
      [sourceRow] as never,
      EVENT_ID,
    );

    expect(result.repaired).toBe(0);
    expect(result.failed).toBeGreaterThan(0);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.filter((c) => c.method !== "GET").every((c) => c.method === "PUT")).toBe(true);
    for (const update of updates) {
      expect(update.payload.dst_repair).toMatchObject({ method: "update", success: false });
      expect(String(update.payload.sync_error)).toContain("dst_repair_failed");
    }
  });
});
