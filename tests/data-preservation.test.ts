import { describe, expect, it } from "vitest";
import { syncShiftAssignment } from "../src/lib/calendar-ops";
import { normalizeMembers, saveOnboardingMembers } from "../src/lib/onboarding.server";

function fixture() {
  const tables: Record<string, Record<string, any>[]> = {
    families: [{ id: "family", babysitter_calendar_source_id: "new-calendar" }],
    family_users: [{ user_id: "owner", family_id: "family", family_member_id: "dad", role: "owner" }],
    family_members: [
      { id: "dad", family_id: "family", name: "Dad", role: "parent", access: "full" },
      { id: "child", family_id: "family", name: "Child", role: "child", access: "view_only" },
      { id: "unrelated", family_id: "family", name: "Caregiver", role: "caregiver", access: "view_only" },
      { id: "foreign", family_id: "other-family", name: "Other", role: "parent" },
    ],
    calendar_sources: [{ subscription_member_id: "child" }],
    event_members: [{ event_id: "apple-event", family_member_id: "child" }],
    babysitter_shifts: [{ id: "shift", family_id: "family", event_id: "old-event", assignee_member_id: "unrelated", family_user_id: "caregiver-login", assignment: "caregiver" }],
  };
  let sequence = 0;
  let writes = 0;
  const db = { from(table: string) {
    let action = "read";
    let payload: Record<string, any> = {};
    const filters: ((row: Record<string, any>) => boolean)[] = [];
    const execute = () => {
      const all = tables[table] ?? [];
      const matches = all.filter((row) => filters.every((filter) => filter(row)));
      if (action !== "read") writes++;
      if (action === "update") matches.forEach((row) => Object.assign(row, payload));
      if (action === "delete") {
        tables[table] = all.filter((row) => !matches.includes(row));
        // Emulate relationships lost when a member is deleted.
        if (table === "family_members") for (const row of matches) {
          tables.event_members = (tables.event_members ?? []).filter((link) => link.family_member_id !== row.id);
          (tables.calendar_sources ?? []).forEach((source) => { if (source.subscription_member_id === row.id) source.subscription_member_id = null; });
        }
      }
      if (action === "insert") {
        const row = { id: `new-${++sequence}`, ...payload };
        tables[table] = [...all, row];
        return { data: [row], error: null };
      }
      return { data: matches, error: null };
    };
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
      order() { return query; }, limit() { return query; },
      update(value: Record<string, any>) { action = "update"; payload = value; return query; },
      insert(value: Record<string, any>) { action = "insert"; payload = value; return query; },
      delete() { action = "delete"; return query; },
      async single() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
      async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } };
  return { db, tables, writes: () => writes };
}

const member = (id?: string, name = "Dad") => ({ id, name, initial: name[0] ?? "D", color: "sky", role: "parent" as const, is_me: id === "dad" });

describe("historical shift preservation", () => {
  it("keeps the same shift and caregiver links when an old-calendar edit omits the hidden assignment", async () => {
    const f = fixture();
    const before = structuredClone(f.tables.babysitter_shifts);
    await syncShiftAssignment(f.db, "family", "old-event", { calendar_source_id: "old-calendar", all_day: true });
    expect(f.tables.babysitter_shifts).toEqual(before);
    expect(f.writes()).toBe(0);
  });
  it("does not treat a stale hidden removal as an explicit supported off-calendar action", async () => {
    const f = fixture();
    await syncShiftAssignment(f.db, "family", "old-event", { calendar_source_id: "old-calendar", all_day: false, babysitter_assignment: { kind: "none" } });
    expect(f.tables.babysitter_shifts?.[0]?.assignee_member_id).toBe("unrelated");
    expect(f.writes()).toBe(0);
  });
  it("preserves new off-calendar event behavior without creating shifts", async () => {
    const f = fixture();
    await syncShiftAssignment(f.db, "family", "new-event", { calendar_source_id: "old-calendar", all_day: false, babysitter_assignment: { kind: "other", name: "Ana" } });
    expect(f.tables.babysitter_shifts?.map((row) => row.event_id)).toEqual(["old-event"]);
  });
});

describe("onboarding member preservation", () => {
  it("keeps stable IDs, Apple associations and imported event links through unchanged saves and edits", async () => {
    const f = fixture();
    const input = normalizeMembers([member("dad"), { ...member("child", "Child"), role: "child" }]);
    const first = await saveOnboardingMembers(f.db, "owner", input);
    const second = await saveOnboardingMembers(f.db, "owner", [input[0] ?? member("dad"), { ...member("child", "New name"), role: "child" }]);
    expect(first.member_ids).toEqual(["dad", "child"]);
    expect(second.member_ids).toEqual(first.member_ids);
    expect(f.tables.family_members?.find((row) => row.id === "child")?.name).toBe("New name");
    expect(f.tables.calendar_sources?.[0]?.subscription_member_id).toBe("child");
    expect(f.tables.event_members).toEqual([{ event_id: "apple-event", family_member_id: "child" }]);
    expect(f.tables.family_users?.[0]?.family_member_id).toBe("dad");
  });
  it("adds a member without replacing omitted or unrelated household members", async () => {
    const f = fixture();
    const result = await saveOnboardingMembers(f.db, "owner", [member("dad"), member(undefined, "Baby")]);
    expect(result.member_ids).toEqual(["dad", "new-1"]);
    expect(f.tables.family_members?.map((row) => row.id)).toEqual(["dad", "child", "unrelated", "foreign", "new-1"]);
  });
  it("deletes only an explicitly removed member", async () => {
    const f = fixture();
    await saveOnboardingMembers(f.db, "owner", [member("dad")], ["child"]);
    expect(f.tables.family_members?.map((row) => row.id)).toEqual(["dad", "unrelated", "foreign"]);
  });
  it.each(["update", "remove"])("rejects foreign-household IDs before any %s writes", async (action) => {
    const f = fixture();
    await expect(saveOnboardingMembers(f.db, "owner", action === "update" ? [member("foreign")] : [member("dad")], action === "remove" ? ["foreign"] : [])).rejects.toThrow("Family members changed");
    expect(f.writes()).toBe(0);
  });
  it("retains existing caregiver role and access on unchanged setup saves", async () => {
    const f = fixture();
    await saveOnboardingMembers(f.db, "owner", [member("unrelated", "Caregiver")]);
    expect(f.tables.family_members?.find((row) => row.id === "unrelated")).toMatchObject({ role: "caregiver", access: "view_only" });
    expect(f.tables.family_users?.[0]?.family_member_id).toBe("dad");
  });
});