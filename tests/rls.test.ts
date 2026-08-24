import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createHousehold,
  createSignedInUser,
  destroyHouseholds,
  destroyUsers,
  hasBackendCredentials,
  type TestHousehold,
  type TestUser,
} from "./helpers/rls-fixtures";

/**
 * Household isolation + role enforcement, exercised against the real database
 * with real signed-in sessions (RLS applies exactly as it does for the app).
 *
 * Household A: ownerA, editorA, viewerA
 * Household B: ownerB  <- must be completely invisible to household A
 */

const FAMILY_SCOPED_TABLES = [
  "events",
  "activities",
  "family_members",
  "calendar_sources",
  "family_users",
  "family_invitations",
  "google_connections",
] as const;

let ownerA: TestUser;
let editorA: TestUser;
let viewerA: TestUser;
let ownerB: TestUser;
let houseA: TestHousehold;
let houseB: TestHousehold;

const suite = hasBackendCredentials ? describe : describe.skip;

/** A write is denied either by an explicit RLS error or by matching zero rows. */
async function expectUpdateDenied(
  client: SupabaseClient,
  table: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await client.from(table).update(patch).eq("id", id).select();
  if (error) {
    expect(error.code).toBe("42501");
    return;
  }
  expect(data ?? []).toHaveLength(0);
}

async function expectDeleteDenied(client: SupabaseClient, table: string, id: string) {
  const { data, error } = await client.from(table).delete().eq("id", id).select();
  if (error) {
    expect(error.code).toBe("42501");
    return;
  }
  expect(data ?? []).toHaveLength(0);
}

async function expectInsertDenied(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
) {
  const { error } = await client.from(table).insert(row).select();
  expect(error, `${table} insert should have been rejected`).not.toBeNull();
  expect(error!.code).toBe("42501");
}

beforeAll(async () => {
  if (!hasBackendCredentials) return;
  [ownerA, editorA, viewerA, ownerB] = await Promise.all([
    createSignedInUser("owner-a"),
    createSignedInUser("editor-a"),
    createSignedInUser("viewer-a"),
    createSignedInUser("owner-b"),
  ]);
  houseA = await createHousehold("RLS Household A", [
    { userId: ownerA.id, role: "owner" },
    { userId: editorA.id, role: "editor" },
    { userId: viewerA.id, role: "viewer" },
  ]);
  houseB = await createHousehold("RLS Household B", [{ userId: ownerB.id, role: "owner" }]);
});

afterAll(async () => {
  if (!hasBackendCredentials) return;
  await destroyHouseholds([houseA?.familyId, houseB?.familyId].filter(Boolean) as string[]);
  await destroyUsers(
    [ownerA?.id, editorA?.id, viewerA?.id, ownerB?.id].filter(Boolean) as string[],
  );
});

suite("household isolation: reads", () => {
  it.each(FAMILY_SCOPED_TABLES)("household A cannot read household B rows in %s", async (table) => {
    const column = "family_id";
    const { data, error } = await ownerA.client
      .from(table)
      .select("*")
      .eq(column, houseB.familyId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("household A cannot read household B's family row", async () => {
    const { data, error } = await ownerA.client
      .from("families")
      .select("*")
      .eq("id", houseB.familyId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("unfiltered selects never leak another household", async () => {
    for (const table of ["events", "activities", "family_members", "calendar_sources"] as const) {
      const { data, error } = await ownerA.client.from(table).select("family_id");
      expect(error).toBeNull();
      const families = new Set((data ?? []).map((r) => (r as { family_id: string }).family_id));
      expect(families.has(houseB.familyId)).toBe(false);
      expect([...families].every((f) => f === houseA.familyId)).toBe(true);
    }

    const families = await ownerA.client.from("families").select("id");
    expect((families.data ?? []).map((f) => f.id)).toEqual([houseA.familyId]);
  });

  it("join tables are scoped through their parent row", async () => {
    const eventMembers = await ownerA.client
      .from("event_members")
      .select("*")
      .eq("event_id", houseB.eventId);
    expect(eventMembers.error).toBeNull();
    expect(eventMembers.data ?? []).toHaveLength(0);

    const activityMembers = await ownerA.client
      .from("activity_members")
      .select("*")
      .eq("activity_id", houseB.activityId);
    expect(activityMembers.error).toBeNull();
    expect(activityMembers.data ?? []).toHaveLength(0);

    const own = await ownerA.client
      .from("event_members")
      .select("*")
      .eq("event_id", houseA.eventId);
    expect(own.data ?? []).toHaveLength(1);
  });

  it("profiles are self-only", async () => {
    await ownerA.client.from("profiles").insert({ id: ownerA.id, display_name: "Owner A" });
    const mine = await ownerA.client.from("profiles").select("*").eq("id", ownerA.id);
    expect(mine.data ?? []).toHaveLength(1);

    const theirs = await ownerB.client.from("profiles").select("*").eq("id", ownerA.id);
    expect(theirs.error).toBeNull();
    expect(theirs.data ?? []).toHaveLength(0);

    await expectInsertDenied(ownerB.client, "profiles", { id: ownerA.id, display_name: "hijack" });
  });

  it("own household data is readable (policies are not blanket-deny)", async () => {
    for (const table of FAMILY_SCOPED_TABLES) {
      const { data, error } = await ownerA.client
        .from(table)
        .select("*")
        .eq("family_id", houseA.familyId);
      expect(error, `${table} read failed`).toBeNull();
      expect((data ?? []).length, `${table} returned no rows for its own household`)
        .toBeGreaterThan(0);
    }
  });
});

suite("household isolation: writes", () => {
  it.each(FAMILY_SCOPED_TABLES)("household A cannot update household B rows in %s", async (table) => {
    const idByTable: Record<string, string> = {
      events: houseB.eventId,
      activities: houseB.activityId,
      family_members: houseB.memberIds[0],
      calendar_sources: houseB.calendarSourceId,
      family_users: houseB.familyUserIds[0],
      family_invitations: houseB.invitationId,
      google_connections: houseB.googleConnectionId,
    };
    const patch: Record<string, unknown> =
      table === "family_users" ? { role: "viewer" } : table === "family_invitations"
        ? { status: "revoked" }
        : table === "google_connections"
          ? { status: "revoked" }
          : table === "events"
            ? { title: "intruder" }
            : { name: "intruder" };
    await expectUpdateDenied(ownerA.client, table, idByTable[table], patch);
  });

  it.each(FAMILY_SCOPED_TABLES)("household A cannot delete household B rows in %s", async (table) => {
    const idByTable: Record<string, string> = {
      events: houseB.eventId,
      activities: houseB.activityId,
      family_members: houseB.memberIds[0],
      calendar_sources: houseB.calendarSourceId,
      family_users: houseB.familyUserIds[0],
      family_invitations: houseB.invitationId,
      google_connections: houseB.googleConnectionId,
    };
    await expectDeleteDenied(ownerA.client, table, idByTable[table]);
  });

  it("household A cannot insert into household B", async () => {
    await expectInsertDenied(ownerA.client, "events", {
      family_id: houseB.familyId,
      title: "intruder",
      start_at: "2026-09-02T10:00:00Z",
      end_at: "2026-09-02T11:00:00Z",
    });
    await expectInsertDenied(ownerA.client, "activities", {
      family_id: houseB.familyId,
      name: "intruder",
    });
    await expectInsertDenied(ownerA.client, "family_members", {
      family_id: houseB.familyId,
      name: "intruder",
      initial: "X",
    });
    await expectInsertDenied(ownerA.client, "calendar_sources", {
      family_id: houseB.familyId,
      name: "intruder",
    });
    await expectInsertDenied(ownerA.client, "google_connections", {
      family_id: houseB.familyId,
      account_email: "intruder@example.com",
    });
  });

  it("household A cannot self-join household B or invite into it", async () => {
    await expectInsertDenied(ownerA.client, "family_users", {
      family_id: houseB.familyId,
      user_id: ownerA.id,
      role: "owner",
    });
    await expectInsertDenied(ownerA.client, "family_invitations", {
      family_id: houseB.familyId,
      email: "intruder@example.com",
      role: "owner",
      invited_by: ownerA.id,
    });
  });

  it("household A cannot attach its members to household B rows", async () => {
    await expectInsertDenied(ownerA.client, "event_members", {
      event_id: houseB.eventId,
      family_member_id: houseA.memberIds[0],
    });
    await expectInsertDenied(ownerA.client, "activity_members", {
      activity_id: houseB.activityId,
      family_member_id: houseA.memberIds[0],
    });
  });

  it("household A cannot rename or delete household B", async () => {
    await expectUpdateDenied(ownerA.client, "families", houseB.familyId, { name: "owned" });
    await expectDeleteDenied(ownerA.client, "families", houseB.familyId);
  });

  it("household B data is byte-for-byte unchanged after the attack run", async () => {
    const event = await ownerB.client.from("events").select("title").eq("id", houseB.eventId);
    expect(event.data?.[0]?.title).toBe("RLS Household B Event");

    const family = await ownerB.client.from("families").select("name").eq("id", houseB.familyId);
    expect(family.data?.[0]?.name).toBe("RLS Household B");

    const users = await ownerB.client
      .from("family_users")
      .select("role")
      .eq("family_id", houseB.familyId);
    expect(users.data).toEqual([{ role: "owner" }]);
  });
});

suite("role enforcement inside one household", () => {
  it("viewer can read everything in their household", async () => {
    for (const table of ["events", "activities", "family_members", "calendar_sources"] as const) {
      const { data, error } = await viewerA.client.from(table).select("*");
      expect(error, `${table} viewer read failed`).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("viewer cannot create, edit or delete events or activities", async () => {
    await expectInsertDenied(viewerA.client, "events", {
      family_id: houseA.familyId,
      title: "viewer event",
      start_at: "2026-09-03T10:00:00Z",
      end_at: "2026-09-03T11:00:00Z",
    });
    await expectUpdateDenied(viewerA.client, "events", houseA.eventId, { title: "viewer edit" });
    await expectDeleteDenied(viewerA.client, "events", houseA.eventId);
    await expectInsertDenied(viewerA.client, "activities", {
      family_id: houseA.familyId,
      name: "viewer activity",
    });
    await expectInsertDenied(viewerA.client, "event_members", {
      event_id: houseA.eventId,
      family_member_id: houseA.memberIds[1],
    });
  });

  it("viewer cannot manage household access or promote themselves", async () => {
    const self = await viewerA.client
      .from("family_users")
      .select("id")
      .eq("user_id", viewerA.id)
      .single();
    await expectUpdateDenied(viewerA.client, "family_users", self.data!.id, { role: "owner" });
    await expectInsertDenied(viewerA.client, "family_invitations", {
      family_id: houseA.familyId,
      email: "friend@example.com",
      role: "owner",
      invited_by: viewerA.id,
    });
    const invitations = await viewerA.client.from("family_invitations").select("*");
    expect(invitations.data ?? []).toHaveLength(0);
  });

  it("editor can manage events and activities", async () => {
    const created = await editorA.client
      .from("events")
      .insert({
        family_id: houseA.familyId,
        title: "editor event",
        start_at: "2026-09-04T10:00:00Z",
        end_at: "2026-09-04T11:00:00Z",
      })
      .select("id")
      .single();
    expect(created.error).toBeNull();

    const updated = await editorA.client
      .from("events")
      .update({ title: "editor event v2" })
      .eq("id", created.data!.id)
      .select();
    expect(updated.data ?? []).toHaveLength(1);

    const removed = await editorA.client
      .from("events")
      .delete()
      .eq("id", created.data!.id)
      .select();
    expect(removed.data ?? []).toHaveLength(1);
  });

  it("editor cannot touch owner-only tables", async () => {
    await expectInsertDenied(editorA.client, "family_members", {
      family_id: houseA.familyId,
      name: "editor member",
      initial: "Z",
    });
    await expectUpdateDenied(editorA.client, "family_members", houseA.memberIds[0], {
      name: "editor rename",
    });
    await expectUpdateDenied(editorA.client, "calendar_sources", houseA.calendarSourceId, {
      name: "editor rename",
    });
    await expectInsertDenied(editorA.client, "family_users", {
      family_id: houseA.familyId,
      user_id: editorA.id,
      role: "owner",
    });
    await expectInsertDenied(editorA.client, "family_invitations", {
      family_id: houseA.familyId,
      email: "editor-invite@example.com",
      role: "viewer",
      invited_by: editorA.id,
    });
    await expectUpdateDenied(editorA.client, "families", houseA.familyId, { name: "editor rename" });
  });

  it("owner can manage members, calendars and invitations", async () => {
    const member = await ownerA.client
      .from("family_members")
      .insert({ family_id: houseA.familyId, name: "Owner Added", initial: "O", color: "sage" })
      .select("id")
      .single();
    expect(member.error).toBeNull();
    await ownerA.client.from("family_members").delete().eq("id", member.data!.id);

    const source = await ownerA.client
      .from("calendar_sources")
      .update({ name: "Owner Renamed" })
      .eq("id", houseA.calendarSourceId)
      .select();
    expect(source.data ?? []).toHaveLength(1);

    const invitation = await ownerA.client
      .from("family_invitations")
      .insert({
        family_id: houseA.familyId,
        email: "owner-invite@example.com",
        role: "viewer",
        invited_by: ownerA.id,
      })
      .select("id, token")
      .single();
    expect(invitation.error).toBeNull();
    expect(String(invitation.data!.token).length).toBeGreaterThanOrEqual(32);
  });

  it("the last owner of a live household cannot be demoted or removed", async () => {
    const self = await ownerA.client
      .from("family_users")
      .select("id")
      .eq("user_id", ownerA.id)
      .single();
    const demote = await ownerA.client
      .from("family_users")
      .update({ role: "editor" })
      .eq("id", self.data!.id)
      .select();
    expect(demote.error?.message ?? "").toContain("at least one owner");

    const remove = await ownerA.client
      .from("family_users")
      .delete()
      .eq("id", self.data!.id)
      .select();
    expect(remove.error?.message ?? "").toContain("at least one owner");
  });
});

suite("anonymous access", () => {
  it("signed-out clients read nothing", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(
      (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"])!,
      (process.env["SUPABASE_PUBLISHABLE_KEY"] ??
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    for (const table of [...FAMILY_SCOPED_TABLES, "families", "profiles"] as const) {
      const { data } = await anon.from(table).select("*");
      expect(data ?? [], `${table} leaked to anonymous callers`).toHaveLength(0);
    }
  });
});
