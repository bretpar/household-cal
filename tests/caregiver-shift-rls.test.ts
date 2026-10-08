import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shiftFrom } from "@/lib/calendar-ops";
import {
  admin, createHousehold, createSignedInUser, destroyHouseholds, destroyUsers,
  hasBackendCredentials, type TestHousehold, type TestUser,
} from "./helpers/rls-fixtures";

const suite = hasBackendCredentials ? describe : describe.skip;

suite("babysitter_shifts caregiver SELECT", () => {
  let owner: TestUser, cgA: TestUser, cgB: TestUser, ownerB: TestUser, cgOther: TestUser;
  let house: TestHousehold, houseB: TestHousehold;
  let memA: string, memB: string, shiftNull: string, shiftLinked: string;

  async function linkCaregiver(h: TestHousehold, user: TestUser, name: string) {
    const db = admin();
    const m = await db.from("family_members").insert({ family_id: h.familyId, name, initial: name[0], color: "sky", role: "caregiver" }).select("id").single();
    if (m.error) throw m.error;
    const fu = await db.from("family_users").update({ family_member_id: m.data.id }).eq("family_id", h.familyId).eq("user_id", user.id).select("id").single();
    if (fu.error) throw fu.error;
    const p = await db.from("babysitter_access_profiles").insert({ family_user_id: fu.data.id, family_id: h.familyId, date_scope: "all_permitted" });
    if (p.error) throw p.error;
    const c = await db.from("babysitter_access_calendars").insert({ family_user_id: fu.data.id, calendar_source_id: h.calendarSourceId });
    if (c.error) throw c.error;
    return { memberId: m.data.id as string, fuId: fu.data.id as string };
  }
  async function shift(h: TestHousehold, memberId: string, fuId: string | null) {
    const db = admin();
    const ev = await db.from("events").insert({ family_id: h.familyId, calendar_source_id: h.calendarSourceId, title: "Shift", start_at: "2026-10-21T15:00:00Z", end_at: "2026-10-22T00:00:00Z", event_type: "childcare" }).select("id").single();
    if (ev.error) throw ev.error;
    const s = await db.from("babysitter_shifts").insert({ family_id: h.familyId, event_id: ev.data.id, assignment: "caregiver", assignee_member_id: memberId, family_user_id: fuId }).select("id").single();
    if (s.error) throw s.error;
    return s.data.id as string;
  }

  beforeAll(async () => {
    [owner, cgA, cgB, ownerB, cgOther] = await Promise.all(["o", "ca", "cb", "ob", "cx"].map(createSignedInUser));
    house = await createHousehold("ShiftA", [{ userId: owner.id, role: "owner" }, { userId: cgA.id, role: "viewer" }, { userId: cgB.id, role: "viewer" }]);
    houseB = await createHousehold("ShiftB", [{ userId: ownerB.id, role: "owner" }, { userId: cgOther.id, role: "viewer" }]);
    await admin().from("families").update({ babysitter_calendar_source_id: house.calendarSourceId }).eq("id", house.familyId);
    await admin().from("families").update({ babysitter_calendar_source_id: houseB.calendarSourceId }).eq("id", houseB.familyId);
    const a = await linkCaregiver(house, cgA, "Michelle");
    memA = a.memberId;
    memB = (await linkCaregiver(house, cgB, "Other")).memberId;
    await linkCaregiver(houseB, cgOther, "Michelle");
    shiftLinked = await shift(house, memA, a.fuId);
    shiftNull = await shift(house, memA, null);
  }, 60_000);

  afterAll(async () => {
    await destroyHouseholds([house?.familyId, houseB?.familyId].filter(Boolean) as string[]);
    await destroyUsers([owner, cgA, cgB, ownerB, cgOther].filter(Boolean).map((u) => u.id));
  });

  const read = async (u: TestUser, id: string) => (await u.client.from("babysitter_shifts").select("id").eq("id", id)).data ?? [];

  it("A: matching family_user_id is readable", async () => expect(await read(cgA, shiftLinked)).toHaveLength(1));
  it("B: NULL family_user_id but matching assignee_member_id is readable", async () => expect(await read(cgA, shiftNull)).toHaveLength(1));
  it("C: a different caregiver cannot read it", async () => {
    expect(await read(cgB, shiftNull)).toHaveLength(0);
    expect(memB).not.toBe(memA);
  });
  it("D: caregiver from another household cannot read it", async () => expect(await read(cgOther, shiftNull)).toHaveLength(0));
});

describe("shift mapping", () => {
  it("E: readable caregiver shift with NULL family_user_id maps to caregiver (is_my_shift)", () => {
    expect(shiftFrom([{ assignment: "caregiver", family_user_id: null, assignee_name: null, assignee_member_id: "m1" }]))
      .toEqual({ kind: "caregiver", family_member_id: "m1" });
  });
});
