import { afterAll, describe, expect, it } from "vitest";

import {
  admin,
  createHousehold,
  createSignedInUser,
  destroyHouseholds,
  destroyUsers,
  hasBackendCredentials,
} from "./helpers/rls-fixtures";
import { deleteAccount, type DeletionDb } from "../src/lib/account-deletion.server";

const db = () => admin() as unknown as DeletionDb;
const families: string[] = [];
const users: string[] = [];

async function userExists(id: string) {
  const { data } = await admin().auth.admin.getUserById(id);
  return Boolean(data.user);
}
async function familyExists(id: string) {
  const { data } = await admin().from("families").select("id").eq("id", id);
  return (data ?? []).length === 1;
}

describe.skipIf(!hasBackendCredentials)("account deletion", () => {
  afterAll(async () => {
    await destroyHouseholds(families);
    await destroyUsers(users);
  });

  it("non-owner: membership removed, household and shared data remain", async () => {
    const owner = await createSignedInUser("del-own");
    const viewer = await createSignedInUser("del-view");
    users.push(owner.id, viewer.id);
    const h = await createHousehold("Del A", [
      { userId: owner.id, role: "owner" },
      { userId: viewer.id, role: "viewer" },
    ]);
    families.push(h.familyId);
    expect(await deleteAccount(db(), viewer.id, {})).toMatchObject({ ok: true });
    expect(await userExists(viewer.id)).toBe(false);
    expect(await familyExists(h.familyId)).toBe(true);
    const ev = await admin().from("events").select("id").eq("id", h.eventId);
    expect(ev.data).toHaveLength(1);
  });

  it("owner with co-owner: household and other owner remain; created_by schedules don't block", async () => {
    const a = await createSignedInUser("del-o1");
    const b = await createSignedInUser("del-o2");
    users.push(a.id, b.id);
    const h = await createHousehold("Del B", [
      { userId: a.id, role: "owner" },
      { userId: b.id, role: "owner" },
    ]);
    families.push(h.familyId);
    await admin()
      .from("email_schedules")
      .insert({ family_id: h.familyId, name: "Probe", frequency: "daily", send_time: "07:00", created_by: a.id });
    await admin().from("google_connections").update({ connected_by: a.id }).eq("id", h.googleConnectionId);
    expect(await deleteAccount(db(), a.id, {})).toMatchObject({ ok: true });
    expect(await userExists(a.id)).toBe(false);
    expect(await userExists(b.id)).toBe(true);
    const g = await admin().from("google_connections").select("connected_by").eq("id", h.googleConnectionId);
    expect(g.data?.[0]?.connected_by).toBeNull();
  });

  it("sole owner with members is blocked, then succeeds with a transfer", async () => {
    const owner = await createSignedInUser("del-so");
    const ed = await createSignedInUser("del-ed");
    users.push(owner.id, ed.id);
    const h = await createHousehold("Del C", [
      { userId: owner.id, role: "owner" },
      { userId: ed.id, role: "editor" },
    ]);
    families.push(h.familyId);
    const blocked = await deleteAccount(db(), owner.id, {});
    expect(blocked.ok).toBe(false);
    expect(await userExists(owner.id)).toBe(true);
    const done = await deleteAccount(db(), owner.id, { transfers: { [h.familyId]: ed.id } });
    expect(done).toMatchObject({ ok: true });
    const fu = await admin().from("family_users").select("role").eq("family_id", h.familyId).eq("user_id", ed.id);
    expect(fu.data?.[0]?.role).toBe("owner");
  });

  it("sole member deletes household only with confirmation; household data cascades", async () => {
    const solo = await createSignedInUser("del-solo");
    users.push(solo.id);
    const h = await createHousehold("Del D", [{ userId: solo.id, role: "owner" }]);
    families.push(h.familyId);
    expect((await deleteAccount(db(), solo.id, {})).ok).toBe(false);
    expect(await deleteAccount(db(), solo.id, { delete_households: [h.familyId] })).toMatchObject({ ok: true });
    expect(await familyExists(h.familyId)).toBe(false);
    const g = await admin().from("google_connections").select("id").eq("id", h.googleConnectionId);
    expect(g.data).toHaveLength(0);
  });

  it("removes pending invitations addressed to the deleted email", async () => {
    const owner = await createSignedInUser("del-inv-o");
    const guest = await createSignedInUser("del-inv-g");
    users.push(owner.id, guest.id);
    const h = await createHousehold("Del E", [{ userId: owner.id, role: "owner" }]);
    families.push(h.familyId);
    await admin().from("family_invitations").insert({
      family_id: h.familyId,
      email: guest.email,
      role: "viewer",
      token: `tok-${guest.id}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(await deleteAccount(db(), guest.id, {})).toMatchObject({ ok: true });
    const inv = await admin().from("family_invitations").select("id").ilike("email", guest.email).eq("status", "pending");
    expect(inv.data).toHaveLength(0);
  });
});
