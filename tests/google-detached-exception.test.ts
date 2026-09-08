/**
 * A Google-edited single occurrence of a recurring series must survive later
 * syncs. Google reports the *original* occurrence as cancelled (that is what
 * detaching means) and can re-key the detached instance id, so the durable
 * identity is family + calendar + recurring id + original start.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const googleState = vi.hoisted(() => ({
  eventStates: new Map<string, string>(),
  liveOccurrences: new Map<string, { id: string; etag?: string; updated?: string } | null>(),
  reset() {
    this.eventStates.clear();
    this.liveOccurrences.clear();
  },
}));

vi.mock("@/lib/google/crypto.server", () => ({
  decryptConnectionKey: () => "test-connection-key",
  encryptConnectionKey: (key: string) => `enc:${key}`,
}));

vi.mock("@/lib/google/api.server", () => {
  class GoogleAuthError extends Error {}
  class GoogleCalendarUnavailableError extends Error {}
  return {
    GoogleAuthError,
    GoogleCalendarUnavailableError,
    getEventState: async (_k: string, _cal: string, eventId: string) =>
      googleState.eventStates.get(eventId) ?? "live",
    findLiveOccurrence: async (
      _k: string,
      _cal: string,
      recurringEventId: string,
      originalStart: string,
    ) => googleState.liveOccurrences.get(`${recurringEventId}|${originalStart}`) ?? null,
    getCalendar: async (_k: string, id: string) => ({ id, summary: "Parker Family" }),
    listEvents: async () => ({ items: [] }),
    insertEvent: async () => ({ id: "unused" }),
    patchEvent: async () => ({ id: "unused" }),
    deleteEvent: async () => {},
    moveEvent: async () => ({ id: "unused" }),
    watchCalendar: async () => {
      throw new Error("not used");
    },
    stopChannel: async () => {},
  };
});

import { applyGoogleEvent } from "@/lib/google/sync.server";

/* -------------------------------------------------- in-memory admin client */

type Row = Record<string, any>;

function makeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "select" | "delete" | "update" | "insert" = "select";
      let updateValues: Row = {};
      let inserted: Row[] = [];

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
        if (mode === "insert") return { data: inserted.map((r) => ({ ...r })), error: null };
        return { data: matching().map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (r[col] ?? null) === val);
          return builder;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === "is") filters.push((r) => r[col] !== val);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          const res = run() as { data: Row[] | null };
          return { data: (res.data ?? [])[0] ?? null, error: null };
        },
        single: async () => {
          const res = run() as { data: Row[] | null };
          return { data: (res.data ?? [])[0] ?? null, error: null };
        },
        delete: () => {
          mode = "delete";
          return builder;
        },
        update: (vals: Row) => {
          mode = "update";
          updateValues = vals;
          return builder;
        },
        insert: (vals: Row | Row[]) => {
          mode = "insert";
          const list = Array.isArray(vals) ? vals : [vals];
          inserted = list.map((v, i) => ({
            id: v["id"] ?? `${table}-${rows.length + i + 1}`,
            ...v,
          }));
          rows.push(...inserted);
          return builder;
        },
        upsert: async (vals: Row, opts?: { onConflict?: string }) => {
          const keys = (opts?.onConflict ?? "id").split(",");
          const existing = rows.find((r) => keys.every((k) => r[k] === vals[k]));
          if (existing) Object.assign(existing, vals);
          else rows.push({ id: vals["id"] ?? `${table}-${rows.length + 1}`, ...vals });
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
const SOURCE = "src-main";
const TITLE = "Piano";
const ORIGINAL_START = "2026-09-09T23:00:00.000Z"; // 4 PM local
const conn = {
  connectionId: "conn-1",
  familyId: FAMILY,
  connectionKey: "test-connection-key",
  accountEmail: "dad@example.com",
};
const source = {
  id: SOURCE,
  family_id: FAMILY,
  name: "Parker Family",
  external_calendar_id: "gcal-1",
  is_main: true,
  google_sync_token: null,
  google_channel_id: null,
  google_channel_resource_id: null,
};
const initials = new Map([
  ["mem-mom", "M"],
  ["mem-dad", "D"],
]);

/** Two distinct recurring events that share the exact same title. */
function baseTables(): Record<string, Row[]> {
  const series = (id: string, hourUtc: string, endUtc: string) => ({
    id,
    family_id: FAMILY,
    calendar_source_id: SOURCE,
    title: TITLE,
    start_at: `2026-09-02T${hourUtc}`,
    end_at: `2026-09-02T${endUtc}`,
    all_day: false,
    location: null,
    notes: null,
    event_type: "activity",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=WE",
    recurrence_until: null,
    excluded_dates: [],
    updated_at: "2026-09-01T00:00:00.000Z",
    last_change_source: "app",
    event_members: [{ family_member_id: "mem-mom", weekdays: null }],
  });
  return {
    events: [
      series("evt-a", "23:00:00.000Z", "2026-09-03T00:00:00.000Z".slice(11)),
      series("evt-b", "01:00:00.000Z", "02:00:00.000Z"),
    ],
    event_members: [
      { event_id: "evt-a", family_member_id: "mem-mom", weekdays: null },
      { event_id: "evt-b", family_member_id: "mem-mom", weekdays: null },
    ],
    event_sync_links: [
      {
        id: "link-a",
        family_id: FAMILY,
        event_id: "evt-a",
        calendar_source_id: SOURCE,
        google_event_id: "g-a-series",
        google_recurring_event_id: null,
        google_original_start: null,
        branch_key: "",
        last_source: "app",
      },
      {
        id: "link-b",
        family_id: FAMILY,
        event_id: "evt-b",
        calendar_source_id: SOURCE,
        google_event_id: "g-b-series",
        google_recurring_event_id: null,
        google_original_start: null,
        branch_key: "",
        last_source: "app",
      },
    ],
  };
}

/** Google's view of the Mom occurrence of event A after an external edit. */
function editedOccurrence(overrides: Row = {}): Row {
  return {
    id: "g-a-occ1",
    summary: "Piano lesson moved - M",
    recurringEventId: "g-a-series",
    originalStartTime: { dateTime: ORIGINAL_START },
    start: { dateTime: "2026-09-10T00:30:00.000Z" },
    end: { dateTime: "2026-09-10T01:30:00.000Z" },
    etag: '"occ-1"',
    updated: "2026-09-07T01:00:00.000Z",
    ...overrides,
  };
}

const detachedRows = (tables: Record<string, Row[]>) =>
  tables["events"]!.filter((e) => e.external_recurring_event_id === "g-a-series");

beforeEach(() => googleState.reset());

/* --------------------------------------------------------------- tests */

describe("detached Google recurring exception survives later syncs", () => {
  it("creates exactly one detached occurrence and excludes it from the parent", async () => {
    const tables = baseTables();
    const admin = makeAdmin(tables);
    await applyGoogleEvent(admin, conn, source, editedOccurrence(), initials);

    const detached = detachedRows(tables);
    expect(detached).toHaveLength(1);
    expect(detached[0]).toMatchObject({
      title: "Piano lesson moved",
      start_at: "2026-09-10T00:30:00.000Z",
      recurrence_rule: null,
      external_event_id: "g-a-occ1",
    });
    // parent A excluded, sibling B untouched
    expect(tables["events"]!.find((e) => e.id === "evt-a")!.excluded_dates).toEqual(["2026-09-09"]);
    expect(tables["events"]!.find((e) => e.id === "evt-b")!.excluded_dates).toEqual([]);
    // the exception link stores the durable occurrence identity
    const link = tables["event_sync_links"]!.find((l) => l.event_id === detached[0]!.id)!;
    expect(link).toMatchObject({
      google_event_id: "g-a-occ1",
      google_recurring_event_id: "g-a-series",
      google_original_start: ORIGINAL_START,
      last_source: "google",
    });
  });

  it("keeps the detached occurrence when Google re-keys it and tombstones the original", async () => {
    const tables = baseTables();
    const admin = makeAdmin(tables);
    await applyGoogleEvent(admin, conn, source, editedOccurrence(), initials);
    const detachedId = detachedRows(tables)[0]!.id;

    // later sync: the old instance id is gone, but the occurrence is still live
    googleState.eventStates.set("g-a-occ1", "missing");
    googleState.liveOccurrences.set(`g-a-series|${ORIGINAL_START}`, {
      id: "g-a-occ1-rekeyed",
      etag: '"occ-2"',
      updated: "2026-09-07T02:00:00.000Z",
    });
    await applyGoogleEvent(
      admin,
      conn,
      source,
      { ...editedOccurrence(), status: "cancelled" },
      initials,
    );

    // same detached row and link survive, re-pointed at the new instance id
    const detached = detachedRows(tables);
    expect(detached).toHaveLength(1);
    expect(detached[0]!.id).toBe(detachedId);
    expect(detached[0]!.external_event_id).toBe("g-a-occ1-rekeyed");
    const links = tables["event_sync_links"]!.filter((l) => l.event_id === detachedId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "event_sync_links-3", google_event_id: "g-a-occ1-rekeyed" });
    // parent exclusion kept, sibling event untouched, no replacement row
    expect(tables["events"]!.find((e) => e.id === "evt-a")!.excluded_dates).toEqual(["2026-09-09"]);
    expect(tables["events"]!.find((e) => e.id === "evt-b")).toMatchObject({
      title: TITLE,
      excluded_dates: [],
    });
    expect(tables["events"]!).toHaveLength(3);
  });

  it("reuses the same row when the re-keyed occurrence is edited again (idempotent)", async () => {
    const tables = baseTables();
    const admin = makeAdmin(tables);
    await applyGoogleEvent(admin, conn, source, editedOccurrence(), initials);
    const detachedId = detachedRows(tables)[0]!.id;

    googleState.eventStates.set("g-a-occ1", "missing");
    googleState.liveOccurrences.set(`g-a-series|${ORIGINAL_START}`, { id: "g-a-occ1-rekeyed" });
    await applyGoogleEvent(
      admin,
      conn,
      source,
      { ...editedOccurrence(), status: "cancelled" },
      initials,
    );

    // the occurrence arrives under its new id, twice
    const rekeyed = editedOccurrence({
      id: "g-a-occ1-rekeyed",
      etag: '"occ-3"',
      updated: "2026-09-07T03:00:00.000Z",
    });
    await applyGoogleEvent(admin, conn, source, rekeyed, initials);
    await applyGoogleEvent(admin, conn, source, rekeyed, initials);

    expect(detachedRows(tables)).toHaveLength(1);
    expect(detachedRows(tables)[0]!.id).toBe(detachedId);
    expect(tables["event_sync_links"]!.filter((l) => l.event_id === detachedId)).toHaveLength(1);
    expect(tables["events"]!.find((e) => e.id === "evt-a")!.excluded_dates).toEqual(["2026-09-09"]);
    expect(tables["events"]!).toHaveLength(3);
  });

  it("still removes the detached occurrence when Google confirms it was deleted", async () => {
    const tables = baseTables();
    const admin = makeAdmin(tables);
    await applyGoogleEvent(admin, conn, source, editedOccurrence(), initials);

    googleState.eventStates.set("g-a-occ1", "cancelled");
    googleState.liveOccurrences.set(`g-a-series|${ORIGINAL_START}`, null);
    await applyGoogleEvent(
      admin,
      conn,
      source,
      { ...editedOccurrence(), status: "cancelled" },
      initials,
    );

    expect(detachedRows(tables)).toHaveLength(0);
    // the parent keeps the exclusion (the occurrence is genuinely gone)
    expect(tables["events"]!.find((e) => e.id === "evt-a")!.excluded_dates).toEqual(["2026-09-09"]);
    expect(tables["events"]!.find((e) => e.id === "evt-b")).toBeTruthy();
  });

  it("keeps the detached occurrence when verification is unavailable", async () => {
    const tables = baseTables();
    const admin = makeAdmin(tables);
    await applyGoogleEvent(admin, conn, source, editedOccurrence(), initials);

    // a different connected calendar reports the tombstone: nothing to verify
    await applyGoogleEvent(
      admin,
      conn,
      { ...source, id: "src-other", external_calendar_id: "gcal-2" },
      { ...editedOccurrence(), status: "cancelled" },
      initials,
    );

    expect(detachedRows(tables)).toHaveLength(1);
  });
});
