import { describe, expect, it, vi } from "vitest";
import { ensureOnboardingBabysitter } from "../src/lib/onboarding-babysitter.server";

function household(existing: string | null, concurrentWinner: string | null = null) {
  let current = existing;
  const deleted: string[] = [];
  const db = { from(table: string) {
    let operation = "read";
    let sourceId = "";
    let candidate = "";
    const query = {
      select() { return query; },
      eq(field: string, value: string) { if (field === "id") sourceId = value; return query; },
      update(value: { babysitter_calendar_source_id: string }) { operation = "claim"; candidate = value.babysitter_calendar_source_id; return query; },
      delete() { operation = "delete"; return query; },
      is() { return query; },
      single: async () => ({ data: { babysitter_calendar_source_id: current }, error: null }),
      then(resolve: (value: unknown) => unknown) {
        if (table === "calendar_sources" && operation === "delete") deleted.push(sourceId);
        if (operation === "claim") {
          if (concurrentWinner) { current = concurrentWinner; return Promise.resolve(resolve({ data: [], error: null })); }
          current = candidate;
          return Promise.resolve(resolve({ data: [{ id: "family" }], error: null }));
        }
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return query;
  } };
  return { db, deleted, current: () => current };
}

describe("optional onboarding Babysitter calendar identity", () => {
  it("revisiting reuses the dedicated calendar rather than creating a duplicate", async () => {
    const h = household("existing-sitter");
    const create = vi.fn(async () => ({ id: "new-sitter" }));
    expect(await ensureOnboardingBabysitter(h.db, "family", create)).toEqual({ id: "existing-sitter" });
    expect(create).not.toHaveBeenCalled();
  });
  it("creates and assigns a dedicated calendar without configuring a caregiver", async () => {
    const h = household(null);
    expect(await ensureOnboardingBabysitter(h.db, "family", async () => ({ id: "new-sitter" }))).toEqual({ id: "new-sitter" });
    expect(h.current()).toBe("new-sitter");
    expect(h.deleted).toEqual([]);
  });
  it("concurrent setup removes its unused source and keeps the already claimed calendar", async () => {
    const h = household(null, "winner-sitter");
    expect(await ensureOnboardingBabysitter(h.db, "family", async () => ({ id: "loser-sitter" }))).toEqual({ id: "winner-sitter" });
    expect(h.deleted).toEqual(["loser-sitter"]);
  });
});