import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
const publishableKey =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

export const hasBackendCredentials = Boolean(url && publishableKey && serviceKey);

export const admin = () =>
  createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const PASSWORD = "Rls-probe-7391-qx";

export type TestUser = {
  id: string;
  email: string;
  client: SupabaseClient;
};

export type TestHousehold = {
  familyId: string;
  memberIds: string[];
  calendarSourceId: string;
  eventId: string;
  activityId: string;
  invitationId: string;
  googleConnectionId: string;
  familyUserIds: string[];
};

/** Creates a confirmed auth user and returns a client signed in as that user. */
export async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `rls-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);

  return { id: data.user.id, email, client };
}

/** Seeds a household with one row in every family-scoped table. */
export async function createHousehold(
  name: string,
  users: { userId: string; role: "owner" | "editor" | "viewer" }[],
): Promise<TestHousehold> {
  const db = admin();
  const owner = users.find((u) => u.role === "owner")!;

  const family = await db
    .from("families")
    .insert({ name, created_by: owner.userId })
    .select("id")
    .single();
  if (family.error) throw new Error(`family insert: ${family.error.message}`);
  const familyId = family.data.id as string;

  const familyUsers = await db
    .from("family_users")
    .insert(users.map((u) => ({ family_id: familyId, user_id: u.userId, role: u.role })))
    .select("id");
  if (familyUsers.error) throw new Error(`family_users insert: ${familyUsers.error.message}`);

  const members = await db
    .from("family_members")
    .insert([
      { family_id: familyId, name: "Probe One", initial: "P", color: "sky", role: "parent" },
      { family_id: familyId, name: "Probe Two", initial: "Q", color: "rose", role: "child" },
    ])
    .select("id");
  if (members.error) throw new Error(`family_members insert: ${members.error.message}`);
  const memberIds = members.data.map((m) => m.id as string);

  const source = await db
    .from("calendar_sources")
    .insert({ family_id: familyId, name: "Probe Calendar", display_mode: "events" })
    .select("id")
    .single();
  if (source.error) throw new Error(`calendar_sources insert: ${source.error.message}`);

  const event = await db
    .from("events")
    .insert({
      family_id: familyId,
      calendar_source_id: source.data.id,
      title: `${name} Event`,
      start_at: "2026-09-01T16:00:00Z",
      end_at: "2026-09-01T17:00:00Z",
      event_type: "activity",
    })
    .select("id")
    .single();
  if (event.error) throw new Error(`events insert: ${event.error.message}`);

  const eventMember = await db
    .from("event_members")
    .insert({ event_id: event.data.id, family_member_id: memberIds[0] });
  if (eventMember.error) throw new Error(`event_members insert: ${eventMember.error.message}`);

  const activity = await db
    .from("activities")
    .insert({ family_id: familyId, name: `${name} Activity`, event_type: "activity" })
    .select("id")
    .single();
  if (activity.error) throw new Error(`activities insert: ${activity.error.message}`);

  const activityMember = await db
    .from("activity_members")
    .insert({ activity_id: activity.data.id, family_member_id: memberIds[0] });
  if (activityMember.error)
    throw new Error(`activity_members insert: ${activityMember.error.message}`);

  const invitation = await db
    .from("family_invitations")
    .insert({
      family_id: familyId,
      email: `invitee-${randomUUID().slice(0, 6)}@example.com`,
      role: "viewer",
      invited_by: owner.userId,
    })
    .select("id")
    .single();
  if (invitation.error) throw new Error(`family_invitations insert: ${invitation.error.message}`);

  const google = await db
    .from("google_connections")
    .insert({ family_id: familyId, connected_by: owner.userId, account_email: "probe@example.com" })
    .select("id")
    .single();
  if (google.error) throw new Error(`google_connections insert: ${google.error.message}`);

  return {
    familyId,
    memberIds,
    calendarSourceId: source.data.id as string,
    eventId: event.data.id as string,
    activityId: activity.data.id as string,
    invitationId: invitation.data.id as string,
    googleConnectionId: google.data.id as string,
    familyUserIds: familyUsers.data.map((r) => r.id as string),
  };
}

export async function destroyHouseholds(familyIds: string[]) {
  const db = admin();
  for (const id of familyIds) {
    await db.from("families").delete().eq("id", id);
  }
}

export async function destroyUsers(userIds: string[]) {
  const db = admin();
  for (const id of userIds) {
    await db.auth.admin.deleteUser(id);
  }
}
