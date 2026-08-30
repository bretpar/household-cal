/**
 * Reconciliation must not treat an event_sync_links row alone as proof of sync:
 * links whose Google event is gone (404/410) or whose calendar source is no
 * longer eligible are pruned, then the normal push path recreates exactly one
 * Google copy. Valid (or unverifiable) links are kept so no duplicates appear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/crypto.server", () => ({
  decryptConnectionKey: () => "test-connection-key",
  encryptConnectionKey: (key: string) => `enc:${key}`,
}));

const googleState = vi.hoisted(() => ({
  eventStates: new Map<string, string>(),
  stateError: null as Error | null,
  inserted: [] as { calendarId: string; body: Record<string, unknown> }[],
  patched: [] as { calendarId: string; eventId: string }[],
  deleted: [] as { calendarId: string; eventId: string }[],
  moved: [] as unknown[],
  reset() {
    this.eventStates.clear();
    this.stateError = null;
    this.inserted = [];
    this.patched = [];
    this.deleted = [];
    this.moved = [];
  },
}));

vi.mock("@/lib/google/api.server", () => {
  class GoogleAuthError extends Error {}
  class GoogleCalendarUnavailableError extends Error {}
  return {
    GoogleAuthError,
    GoogleCalendarUnavailableError,
    getCalendar: async (_key: string, id: string) => ({ id, summary: "Parker Family" }),
    listEvents: async () => ({ items: [], nextSyncToken: "sync-token-1" }),
    getEventState: async (_key: string, _calendarId: string, eventId: string) => {
      if (googleState.stateError) throw googleState.stateError;
      return googleState.eventStates.get(eventId) ?? "ok";
    },
    insertEvent: async (_key: string, calendarId: string, body: Record<string, unknown>) => {
      const id = `g-new-${googleState.inserted.length + 1}`;
      googleState.inserted.push({ calendarId, body });
      return { id, etag: "etag-new", updated: "2026-08-30T00:00:00.000Z" };
    },
    patchEvent: async (_key: string, calendarId: string, eventId: string) => {
      googleState.patched.push({ calendarId, eventId });
      return { id: eventId, etag: "etag-patch", updated: "2026-08-30T00:00:00.000Z" };
    },
    moveEvent: async (...args: unknown[]) => {
      googleState.moved.push(args);
    },
    deleteEvent: async (_key: string, calendarId: string, eventId: string) => {
      googleState.deleted.push({ calendarId, eventId });
    },
    watchCalendar: async () => {
      throw new Error("watch channels not used in these tests");
    },
    stopChannel: async () => {},
  };
});

import { reconcileHousehold } from "@/lib/google/sync.server";

/* -------------------------------------------------- in-memory admin client */

type Row = Record<string, any>;

function makeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "delete" | "update" = "select";
      let updateValues: Row = {};

      const matching = () => rows.filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (mode === "delete") {
          const doomed = new Set(matching());
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (doomed.has(rows[i]!)) rows.splice(i, 1);
          }
          return { data: null, error: null };
        }
        if (mode === "update") {
          for (const row of matching()) Object.assign(row, updateValues);
          return { data: null, error: null };
        }
        return { data: matching().map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === "is") filters.push((r) => r[col] !== val);
          return builder;
        },
        lte: (col: string, val: string) => {
          filters.push((r) => r[col] <= val);
          return builder;
        },
        lt: (col: string, val: number | string) => {
          filters.push((r) => r[col] !== undefined && r[col] < val);
          return builder;
        },

        order: () => builder,
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        delete: () => {
          mode = "delete";
          return builder;
        },
        update: (vals: Row) => {
          mode = "update";
          updateValues = vals;
          return builder;
        },
        upsert: async (vals: Row, opts?: { onConflict?: string }) => {
          const keys = (opts?.onConflict ?? "id").split(",");
          const existing = rows.find((r) => keys.every((k) => r[k] === vals[k]));
          if (existing) Object.assign(existing, vals);
          else rows.push({ id: vals.id ?? `link-${rows.length + 1}`, ...vals });
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
}

/* ------------------------------------------------------------- fixtures */

const FAMILY = "fam-1";
const EVENT = "evt-1";
const SOURCE = "src-main";

function baseTables(): Record<string, Row[]> {
  return {
    families: [{ id: FAMILY, timezone: "America/Los_Angeles" }],
    google_connections: [
      { id: "conn-1", family_id: FAMILY, account_email: "dad@example.com", status: "connected" },
    ],
    google_connection_secrets: [{ connection_id: "conn-1", connection_key_ciphertext: "enc:key" }],
    calendar_sources: [
      {
        id: SOURCE,
        family_id: FAMILY,
        name: "Parker Family",
        external_calendar_id: "gcal-1",
        is_main: true,
        provider: "google",
        sync_status: "active",
        sort_order: 0,
        google_sync_token: null,
        google_channel_id: null,
        google_channel_resource_id: null,
      },
    ],
    family_members: [{ id: "mem-dad", initial: "D", sort_order: 0 }],
    events: [
      {
        id: EVENT,
        family_id: FAMILY,
        calendar_source_id: SOURCE,
        title: "Kids Place",
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        all_day: false,
        location: null,
        notes: null,
        event_type: "activity",
        recurrence_rule: "FREQ=WEEKLY",
        recurrence_until: null,
        excluded_dates: [],
        updated_at: new Date().toISOString(),
        event_members: [{ family_member_id: "mem-dad", weekdays: null }],
      },
    ],
    event_sync_links: [],
  };
}

function linkRow(overrides: Row = {}): Row {
  return {
    id: "link-1",
    family_id: FAMILY,
    event_id: EVENT,
    calendar_source_id: SOURCE,
    google_event_id: "g-live",
    branch_key: "",
    app_version: 2,
    ...overrides,
  };
}


beforeEach(() => {
  googleState.reset();
  delete process.env["PUBLIC_APP_ORIGIN"];
  delete process.env["LOVABLE_CRON_SECRET"];
});

/* --------------------------------------------------------------- tests */

describe("reconcileHousehold stale-link repair", () => {
  it("deletes a link whose Google event is missing and re-pushes exactly one copy", async () => {
    const tables = baseTables();
    tables["event_sync_links"]!.push(linkRow({ google_event_id: "g-dead" }));
    googleState.eventStates.set("g-dead", "missing");

    const admin = makeAdmin(tables);
    const result = await reconcileHousehold(admin, FAMILY);

    expect(result).toMatchObject({ repaired: 1 });
    // stale link removed; exactly one fresh link written by the push
    expect(tables["event_sync_links"]).toHaveLength(1);
    expect(tables["event_sync_links"]![0]).toMatchObject({
      event_id: EVENT,
      calendar_source_id: SOURCE,
      google_event_id: "g-new-1",
      branch_key: "",
      last_source: "app",
    });
    // a single insert, not a patch against the dead Google id
    expect(googleState.inserted).toHaveLength(1);
    expect(googleState.inserted[0]!.calendarId).toBe("gcal-1");
    expect(googleState.patched).toHaveLength(0);

    // a second reconciliation finds the live replacement and does not duplicate
    googleState.eventStates.set("g-new-1", "ok");
    const again = await reconcileHousehold(admin, FAMILY);
    expect(again).toMatchObject({ repaired: 0 });
    expect(googleState.inserted).toHaveLength(1);
    expect(tables["event_sync_links"]).toHaveLength(1);
  });

  it("deletes a link whose calendar source is no longer eligible and re-pushes to the main calendar", async () => {
    const tables = baseTables();
    // the linked source lost its Google calendar id, so googleSources() skips it
    tables["calendar_sources"]!.push({
      id: "src-paused",
      family_id: FAMILY,
      name: "Old calendar",
      external_calendar_id: null,
      is_main: false,
      provider: "google",
      sync_status: "paused",
      sort_order: 1,
    });
    tables["event_sync_links"]!.push(
      linkRow({ calendar_source_id: "src-paused", google_event_id: "g-orphan" }),
    );

    const admin = makeAdmin(tables);
    const result = await reconcileHousehold(admin, FAMILY);

    expect(result).toMatchObject({ repaired: 1 });
    expect(tables["event_sync_links"]).toHaveLength(1);
    expect(tables["event_sync_links"]![0]).toMatchObject({
      calendar_source_id: SOURCE,
      google_event_id: "g-new-1",
    });
    // Google is never asked about an event on an ineligible source
    expect(googleState.eventStates.has("g-orphan")).toBe(false);
    expect(googleState.inserted).toHaveLength(1);
  });

  it("keeps a link whose Google event is still live and does not push again", async () => {
    const tables = baseTables();
    tables["event_sync_links"]!.push(linkRow({ google_event_id: "g-live" }));
    googleState.eventStates.set("g-live", "ok");

    const admin = makeAdmin(tables);
    const result = await reconcileHousehold(admin, FAMILY);

    expect(result).toMatchObject({ repaired: 0 });
    expect(tables["event_sync_links"]).toHaveLength(1);
    expect(tables["event_sync_links"]![0]!.google_event_id).toBe("g-live");
    expect(googleState.inserted).toHaveLength(0);
    expect(googleState.patched).toHaveLength(0);
  });

  it("keeps a link when Google verification fails transiently, avoiding duplicates", async () => {
    const tables = baseTables();
    tables["event_sync_links"]!.push(linkRow({ google_event_id: "g-flaky" }));
    googleState.stateError = new Error("backendError: temporary");

    const admin = makeAdmin(tables);
    const result = await reconcileHousehold(admin, FAMILY);

    // an unknown answer counts as usable: no prune, no re-push, no duplicate
    expect(result).toMatchObject({ repaired: 0 });
    expect(tables["event_sync_links"]).toHaveLength(1);
    expect(tables["event_sync_links"]![0]!.google_event_id).toBe("g-flaky");
    expect(googleState.inserted).toHaveLength(0);
  });
});
