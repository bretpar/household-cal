import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_CATEGORIES,
  UNCATEGORIZED_LABEL,
  appearanceForEvent,
  canAddCategory,
  type EventCategory,
} from "../src/lib/event-categories";
import {
  createCategory,
  deleteCategory,
  saveFamilyMember,
  updateCategory,
} from "../src/lib/settings.server";
import type { Db } from "../src/lib/calendar-ops";

/* ------------------------------------------------------- in-memory fake db */

const FAMILY = "fam-1";
const USER = "user-1";

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  let nextId = 1;

  function builder(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    let filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: any = null;
    let orderKey: string | null = null;

    const apply = () => rows.filter((r) => filters.every((f) => f(r)));

    const api: any = {
      select: () => api,
      eq: (col: string, value: unknown) => {
        filters = [...filters, (r) => r[col] === value];
        return api;
      },
      in: (col: string, values: unknown[]) => {
        filters = [...filters, (r) => values.includes(r[col])];
        return api;
      },
      order: (col: string) => {
        orderKey = col;
        return api;
      },
      limit: () => api,
      insert: (rowsIn: Row | Row[]) => {
        mode = "insert";
        payload = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
        return api;
      },
      update: (patch: Row) => {
        mode = "update";
        payload = patch;
        return api;
      },
      delete: () => {
        mode = "delete";
        return api;
      },
      single: () => api.then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error })),
      then: (resolve: (value: any) => unknown) => {
        if (mode === "insert") {
          const created = payload.map((r: Row) => ({ id: `id-${nextId++}`, ...r }));
          rows.push(...created);
          return Promise.resolve(resolve({ data: created, error: null }));
        }
        if (mode === "update") {
          const hits = apply();
          for (const hit of hits) Object.assign(hit, payload);
          return Promise.resolve(resolve({ data: hits, error: null }));
        }
        if (mode === "delete") {
          const hits = apply();
          for (const hit of hits) {
            rows.splice(rows.indexOf(hit), 1);
            // mirrors ON DELETE SET NULL on events.category_id
            for (const event of tables["events"] ?? []) {
              if (event["category_id"] === hit["id"]) event["category_id"] = null;
            }
          }
          return Promise.resolve(resolve({ data: hits, error: null }));
        }
        const data = orderKey
          ? [...apply()].sort((a, b) => (a[orderKey!] ?? 0) - (b[orderKey!] ?? 0))
          : apply();
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) } as unknown as Db;
}

function baseTables(extra: Partial<Record<string, Row[]>> = {}) {
  return {
    family_users: [{ id: "fu-1", family_id: FAMILY, user_id: USER, role: "owner" }],
    families: [{ id: FAMILY, name: "Test House" }],
    event_categories: [],
    events: [],
    event_members: [],
    family_members: [],
    ...extra,
  } as Record<string, Row[]>;
}

async function categoriesOf(tables: Record<string, Row[]>): Promise<EventCategory[]> {
  return tables["event_categories"] as EventCategory[];
}

/* ------------------------------------------------------------------- tests */

describe("event categories", () => {
  it("allows at most 7 custom categories", async () => {
    const tables = baseTables();
    const db = makeDb(tables);
    for (let i = 0; i < MAX_CUSTOM_CATEGORIES; i += 1) {
      await createCategory(db, USER, { name: `Cat ${i}`, color: "sky" });
    }
    expect((await categoriesOf(tables)).length).toBe(7);
    await expect(createCategory(db, USER, { name: "One too many", color: "rose" })).rejects.toThrow(
      /up to 7/,
    );
  });

  it("keeps Uncategorized outside the 7-category limit and undeletable", async () => {
    const tables = baseTables();
    const db = makeDb(tables);
    for (let i = 0; i < MAX_CUSTOM_CATEGORIES; i += 1) {
      await createCategory(db, USER, { name: `Cat ${i}`, color: "sky" });
    }
    const categories = await categoriesOf(tables);
    expect(canAddCategory(categories)).toBe(false);
    // Uncategorized is a state, not a row: it can never be listed or removed.
    expect(categories.some((c) => c.name === UNCATEGORIZED_LABEL)).toBe(false);
    expect(appearanceForEvent(categories, null).label).toBe(UNCATEGORIZED_LABEL);
  });

  it("adds, renames, recolors and removes a category", async () => {
    const tables = baseTables();
    const db = makeDb(tables);
    const { id } = await createCategory(db, USER, { name: "Sports", color: "sky" });

    await updateCategory(db, USER, { id, name: "Soccer", color: "coral" });
    let category = (await categoriesOf(tables))[0]!;
    expect(category.name).toBe("Soccer");
    expect(category.color).toBe("coral");

    await expect(
      createCategory(db, USER, { name: " soccer ", color: "sage" }),
    ).rejects.toThrow(/already used/);
    await expect(updateCategory(db, USER, { id, color: "#ff0000" })).rejects.toThrow(/palette/);

    await deleteCategory(db, USER, id);
    expect(await categoriesOf(tables)).toHaveLength(0);
  });

  it("removing a category keeps its events and makes them Uncategorized", async () => {
    const tables = baseTables();
    const db = makeDb(tables);
    const { id } = await createCategory(db, USER, { name: "School", color: "sky" });
    tables["events"] = [{ id: "ev-1", family_id: FAMILY, title: "Drop-off", category_id: id }];

    await deleteCategory(db, USER, id);

    expect(tables["events"]).toHaveLength(1);
    expect(tables["events"]![0]!["category_id"]).toBeNull();
    expect(appearanceForEvent(await categoriesOf(tables), null).label).toBe(UNCATEGORIZED_LABEL);
  });

  it("an untouched Google import resolves to Uncategorized without breaking sync", async () => {
    const tables = baseTables();
    const db = makeDb(tables);
    const { id } = await createCategory(db, USER, { name: "Family", color: "amber" });
    const google = {
      id: "ev-g",
      family_id: FAMILY,
      title: "Imported",
      category_id: null,
      external_event_id: "g-123",
      external_recurring_event_id: "g-series",
    };
    tables["events"] = [google];

    const categories = await categoriesOf(tables);
    expect(appearanceForEvent(categories, google.category_id).label).toBe(UNCATEGORIZED_LABEL);

    // assigning a category later leaves the Google linkage untouched
    google.category_id = id;
    expect(appearanceForEvent(categories, google.category_id).label).toBe("Family");
    expect(google.external_event_id).toBe("g-123");
    expect(google.external_recurring_event_id).toBe("g-series");
  });
});

describe("family member settings", () => {
  it("editing name, initial and color preserves the member id and event links", async () => {
    const tables = baseTables({
      family_members: [
        {
          id: "fm-1",
          family_id: FAMILY,
          name: "Bailey",
          initial: "B",
          color: "sky",
          role: "child",
          access: "view_only",
          active: true,
          sort_order: 0,
        },
      ],
      event_members: [{ event_id: "ev-1", family_member_id: "fm-1", weekdays: ["MO"] }],
    });
    const db = makeDb(tables);

    const result = await saveFamilyMember(db, USER, {
      id: "fm-1",
      name: "Bailey P",
      initial: "bp",
      color: "coral",
      role: "child",
      active: false,
    });

    expect(result.id).toBe("fm-1");
    const member = tables["family_members"]![0]!;
    expect(member["name"]).toBe("Bailey P");
    expect(member["initial"]).toBe("BP");
    expect(member["color"]).toBe("coral");
    expect(member["active"]).toBe(false);
    // assignments (including per-person weekdays) untouched
    expect(tables["event_members"]).toEqual([
      { event_id: "ev-1", family_member_id: "fm-1", weekdays: ["MO"] },
    ]);
  });
});
