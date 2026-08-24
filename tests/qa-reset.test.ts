import { describe, expect, it, beforeAll, afterAll } from "vitest";

import {
  admin,
  createHousehold,
  createSignedInUser,
  destroyHouseholds,
  destroyUsers,
  hasBackendCredentials,
  type TestHousehold,
  type TestUser,
} from "./helpers/rls-fixtures";
import {
  QA_OWNER_EMAILS,
  QA_VIEWER_EMAIL,
  authorizeQaCaller,
  resetQaHousehold,
  type AdminDb,
} from "../src/lib/qa-reset.server";

/**
 * Exercises the developer-only QA reset against the real database, including the
 * safety guarantees: unrelated households untouched, viewer and non-QA denied.
 */

const suite = hasBackendCredentials ? describe : describe.skip;

let db: AdminDb;
let qaIds: Record<string, string>;
let outsider: TestUser;
let outsiderHouse: TestHousehold;

async function userIdByEmail(email: string): Promise<string> {
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await (admin() as any).auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find(
      (u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit.id as string;
    if ((data?.users ?? []).length < 200) break;
  }
  throw new Error(`QA user missing: ${email}`);
}

suite("developer QA reset", () => {
  beforeAll(async () => {
    db = admin() as unknown as AdminDb;
    qaIds = {
      dad: await userIdByEmail(QA_OWNER_EMAILS[0]),
      mom: await userIdByEmail(QA_OWNER_EMAILS[1]),
      sitter: await userIdByEmail(QA_VIEWER_EMAIL),
    };
    outsider = await createSignedInUser("qa-outsider");
    outsiderHouse = await createHousehold("Unrelated House", [
      { userId: outsider.id, role: "owner" },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (outsiderHouse) await destroyHouseholds([outsiderHouse.familyId]);
    if (outsider) await destroyUsers([outsider.id]);
  }, 60_000);

  it("restores the baseline after test data is added", async () => {
    // seed disposable QA data
    const first = await resetQaHousehold(db, qaIds.dad);
    const familyId = first.family_id;
    const { data: sources } = await db
      .from("calendar_sources")
      .select("id")
      .eq("family_id", familyId);
    const now = new Date();
    await db.from("events").insert([
      {
        family_id: familyId,
        title: "QA event 1",
        start_at: now.toISOString(),
        end_at: new Date(now.getTime() + 3600_000).toISOString(),
        calendar_source_id: sources?.[0]?.id ?? null,
      },
      {
        family_id: familyId,
        title: "QA recurring",
        start_at: now.toISOString(),
        end_at: new Date(now.getTime() + 3600_000).toISOString(),
        recurrence_rule: "FREQ=WEEKLY",
      },
    ]);
    await db.from("activities").insert({ family_id: familyId, name: "QA activity" });
    await db.from("family_invitations").insert({
      family_id: familyId,
      email: "disposable-qa@example.com",
      role: "viewer",
      invited_by: qaIds.dad,
    });

    const summary = await resetQaHousehold(db, qaIds.dad);
    expect(summary.family_name).toBe("Parker Family");
    expect(summary.deleted.events).toBe(2);
    expect(summary.deleted.activities).toBe(1);
    expect(summary.deleted.invitations).toBe(1);

    const counts = await Promise.all(
      ["events", "activities", "family_invitations"].map(async (t) => {
        const { data } = await db.from(t).select("id").eq("family_id", summary.family_id);
        return (data ?? []).length;
      }),
    );
    expect(counts).toEqual([0, 0, 0]);
  }, 120_000);

  it("preserves connected Google calendar slots while clearing test data", async () => {
    const seed = await resetQaHousehold(db, qaIds.dad);
    const familyId = seed.family_id;
    const { data: google } = await db
      .from("calendar_sources")
      .insert({
        family_id: familyId,
        name: "QA Google",
        provider: "google",
        external_calendar_id: "qa-google-calendar@group.calendar.google.com",
        google_sync_token: "stale-token",
        sort_order: 5,
      })
      .select("id")
      .single();

    const summary = await resetQaHousehold(db, qaIds.dad);
    expect(summary.google_calendars_preserved).toBe(1);

    const { data: after } = await db
      .from("calendar_sources")
      .select("id, provider, external_calendar_id, google_sync_token")
      .eq("family_id", familyId);
    const kept = (after ?? []).find((s: any) => s.id === google.id);
    expect(kept?.provider).toBe("google");
    expect(kept?.external_calendar_id).toBe("qa-google-calendar@group.calendar.google.com");
    expect(kept?.google_sync_token).toBeNull();
    expect((after ?? []).filter((s: any) => s.provider === "local").length).toBe(2);

    await db.from("calendar_sources").delete().eq("id", google.id);
  }, 120_000);

  it("leaves exactly one Parker Family with the D/M/B/E/J baseline and correct roles", async () => {
    const summary = await resetQaHousehold(db, qaIds.mom);

    const { data: fams } = await db
      .from("families")
      .select("id, name")
      .eq("name", "Parker Family");
    const qaFams = (fams ?? []).filter((f: any) => f.id === summary.family_id);
    expect(qaFams.length).toBe(1);

    const { data: members } = await db
      .from("family_members")
      .select("initial")
      .eq("family_id", summary.family_id);
    expect((members ?? []).map((m: any) => m.initial).sort().join("")).toBe("BDEJM");

    const { data: memberships } = await db
      .from("family_users")
      .select("user_id, role, family_member_id")
      .eq("family_id", summary.family_id);
    expect((memberships ?? []).length).toBe(3);
    const byUser = new Map((memberships ?? []).map((m: any) => [m.user_id, m]));
    expect(byUser.get(qaIds.dad)?.role).toBe("owner");
    expect(byUser.get(qaIds.mom)?.role).toBe("owner");
    expect(byUser.get(qaIds.sitter)?.role).toBe("viewer");

    const { data: idByInitial } = await db
      .from("family_members")
      .select("id, initial")
      .eq("family_id", summary.family_id);
    const lookup = new Map((idByInitial ?? []).map((m: any) => [m.initial, m.id]));
    expect(byUser.get(qaIds.dad)?.family_member_id).toBe(lookup.get("D"));
    expect(byUser.get(qaIds.mom)?.family_member_id).toBe(lookup.get("M"));
  }, 120_000);

  it("is idempotent", async () => {
    const a = await resetQaHousehold(db, qaIds.dad);
    const b = await resetQaHousehold(db, qaIds.dad);
    expect(b.family_id).toBe(a.family_id);
    expect(b.households_removed).toBe(0);
    expect(b.members.length).toBe(5);

    const { data: memberships } = await db
      .from("family_users")
      .select("id")
      .eq("family_id", b.family_id);
    expect((memberships ?? []).length).toBe(3);
  }, 120_000);

  it("never touches an unrelated household", async () => {
    const before = await Promise.all(
      ["events", "activities", "family_members", "family_users", "calendar_sources"].map(
        async (t) => {
          const { data } = await db.from(t).select("id").eq("family_id", outsiderHouse.familyId);
          return (data ?? []).length;
        },
      ),
    );
    await resetQaHousehold(db, qaIds.dad);
    const after = await Promise.all(
      ["events", "activities", "family_members", "family_users", "calendar_sources"].map(
        async (t) => {
          const { data } = await db.from(t).select("id").eq("family_id", outsiderHouse.familyId);
          return (data ?? []).length;
        },
      ),
    );
    expect(after).toEqual(before);
    expect(before.every((n) => n > 0)).toBe(true);
  }, 120_000);

  it("denies the QA viewer account", async () => {
    const auth = await authorizeQaCaller(db, qaIds.sitter);
    expect(auth.authorized).toBe(false);
    await expect(resetQaHousehold(db, qaIds.sitter)).rejects.toThrow(/not available/i);
  }, 60_000);

  it("denies an ordinary non-QA owner", async () => {
    const auth = await authorizeQaCaller(db, outsider.id);
    expect(auth.authorized).toBe(false);
    await expect(resetQaHousehold(db, outsider.id)).rejects.toThrow(/not available/i);
  }, 60_000);
});
