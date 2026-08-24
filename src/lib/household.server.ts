/**
 * Household access helpers: memberships (login users) and invitations.
 *
 * A "family member" is a person drawn on the calendar. A "membership" is a login
 * user with access to the household. They are separate concepts; a membership may
 * optionally point at a family member via family_member_id.
 */

export type Db = { from: (table: string) => any };
export type AdminDb = Db & {
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } }>;
      listUsers: (opts?: { page?: number; perPage?: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
      }>;
    };
  };
};

export type HouseholdRole = "owner" | "editor" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface HouseholdMembership {
  id: string;
  user_id: string;
  role: HouseholdRole;
  display_name: string | null;
  email: string | null;
  family_member_id: string | null;
  is_self: boolean;
}

export interface HouseholdInvitation {
  id: string;
  email: string;
  role: HouseholdRole;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  token: string | null;
}

export interface HouseholdAccessData {
  family_id: string | null;
  family_name: string | null;
  my_role: HouseholdRole | null;
  memberships: HouseholdMembership[];
  invitations: HouseholdInvitation[];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertRole(role: unknown): HouseholdRole {
  if (role === "owner" || role === "editor" || role === "viewer") return role;
  throw new Error("Choose a valid role");
}

/** The household the user is currently working in (their first membership). */
export async function resolveCurrentFamily(
  db: Db,
  userId: string,
): Promise<{ familyId: string; role: HouseholdRole; name: string | null } | null> {
  const { data, error } = await db
    .from("family_users")
    .select("family_id, role, families(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { familyId: row.family_id, role: row.role, name: row.families?.name ?? null };
}

export async function requireOwner(db: Db, userId: string, familyId: string): Promise<void> {
  const { data, error } = await db
    .from("family_users")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .limit(1);
  if (error) throw error;
  if (data?.[0]?.role !== "owner") throw new Error("Only household owners can do that");
}

export async function loadHouseholdAccess(
  db: Db,
  admin: AdminDb,
  userId: string,
): Promise<HouseholdAccessData> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) {
    return {
      family_id: null,
      family_name: null,
      my_role: null,
      memberships: [],
      invitations: [],
    };
  }

  // RLS keeps this to households the caller belongs to.
  const { data: rows, error } = await db
    .from("family_users")
    .select("id, user_id, role, family_member_id, created_at")
    .eq("family_id", current.familyId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const userIds: string[] = (rows ?? []).map((r: any) => r.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameOf = new Map<string, string | null>(
    (profiles ?? []).map((p: any) => [p.id, p.display_name ?? null]),
  );

  const emails = new Map<string, string | null>();
  for (const id of userIds) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      emails.set(id, data.user?.email ?? null);
    } catch {
      emails.set(id, null);
    }
  }

  const roleRank: Record<HouseholdRole, number> = { owner: 0, editor: 1, viewer: 2 };
  const memberships: HouseholdMembership[] = (rows ?? [])
    .map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      role: r.role as HouseholdRole,
      display_name: nameOf.get(r.user_id) ?? null,
      email: emails.get(r.user_id) ?? null,
      family_member_id: r.family_member_id ?? null,
      is_self: r.user_id === userId,
    }))
    .sort((a: HouseholdMembership, b: HouseholdMembership) => roleRank[a.role] - roleRank[b.role]);

  let invitations: HouseholdInvitation[] = [];
  if (current.role === "owner") {
    const { data: invites, error: invErr } = await db
      .from("family_invitations")
      .select("id, email, role, status, expires_at, created_at, token")
      .eq("family_id", current.familyId)
      .order("created_at", { ascending: false });
    if (invErr) throw invErr;
    invitations = (invites ?? []).map((i: any) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      status: new Date(i.expires_at) < new Date() && i.status === "pending" ? "expired" : i.status,
      expires_at: i.expires_at,
      created_at: i.created_at,
      token: i.status === "pending" ? i.token : null,
    }));
  }

  return {
    family_id: current.familyId,
    family_name: current.name,
    my_role: current.role,
    memberships,
    invitations,
  };
}

export async function createInvitation(
  db: Db,
  admin: AdminDb,
  userId: string,
  email: string,
  role: HouseholdRole,
): Promise<{ id: string; token: string }> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);

  const clean = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Enter a valid email address");

  // already a member of this household?
  const existingUserId = await findUserIdByEmail(admin, clean);
  if (existingUserId) {
    const { data: already } = await db
      .from("family_users")
      .select("id")
      .eq("family_id", current.familyId)
      .eq("user_id", existingUserId)
      .limit(1);
    if (already && already.length > 0) throw new Error("That person already has access");
  }

  // retire any previous pending invitation for this email
  await db
    .from("family_invitations")
    .update({ status: "revoked" })
    .eq("family_id", current.familyId)
    .eq("status", "pending")
    .ilike("email", clean);

  const { data, error } = await db
    .from("family_invitations")
    .insert({ family_id: current.familyId, email: clean, role, invited_by: userId })
    .select("id, token")
    .single();
  if (error) throw error;
  return { id: data.id, token: data.token };
}

export async function findUserIdByEmail(admin: AdminDb, email: string): Promise<string | null> {
  const clean = normalizeEmail(email);
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === clean);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

export async function setInvitationStatus(
  db: Db,
  userId: string,
  invitationId: string,
  status: "revoked",
): Promise<void> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);
  const { error } = await db
    .from("family_invitations")
    .update({ status })
    .eq("id", invitationId)
    .eq("family_id", current.familyId);
  if (error) throw error;
}

export async function refreshInvitation(
  db: Db,
  userId: string,
  invitationId: string,
): Promise<{ token: string }> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("family_invitations")
    .update({ status: "pending", expires_at: expires })
    .eq("id", invitationId)
    .eq("family_id", current.familyId)
    .select("token")
    .single();
  if (error) throw error;
  return { token: data.token };
}

export async function changeMembershipRole(
  db: Db,
  userId: string,
  membershipId: string,
  role: HouseholdRole,
): Promise<void> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);
  const { error } = await db
    .from("family_users")
    .update({ role })
    .eq("id", membershipId)
    .eq("family_id", current.familyId);
  if (error) throw error;
}

export async function removeMembership(
  db: Db,
  userId: string,
  membershipId: string,
): Promise<void> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);
  const { error } = await db
    .from("family_users")
    .delete()
    .eq("id", membershipId)
    .eq("family_id", current.familyId);
  if (error) throw error;
}

export interface InvitationPreview {
  family_name: string;
  role: HouseholdRole;
  email: string;
  status: InvitationStatus;
}

export async function previewInvitation(
  admin: AdminDb,
  token: string,
): Promise<InvitationPreview | null> {
  const { data } = await admin
    .from("family_invitations")
    .select("email, role, status, expires_at, families(name)")
    .eq("token", token)
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  const expired = row.status === "pending" && new Date(row.expires_at) < new Date();
  return {
    family_name: row.families?.name ?? "this household",
    role: row.role,
    email: row.email,
    status: expired ? "expired" : row.status,
  };
}

/** Attaches the signed-in user to the invited household. Idempotent. */
export async function acceptInvitationByToken(
  admin: AdminDb,
  token: string,
  userId: string,
  userEmail: string | null,
): Promise<{ family_id: string; role: HouseholdRole }> {
  const { data } = await admin
    .from("family_invitations")
    .select("id, family_id, email, role, status, expires_at")
    .eq("token", token)
    .limit(1);
  const invite = data?.[0];
  if (!invite) throw new Error("This invitation link is not valid");

  if (invite.status === "revoked") throw new Error("This invitation was revoked");
  if (invite.status === "pending" && new Date(invite.expires_at) < new Date()) {
    await admin.from("family_invitations").update({ status: "expired" }).eq("id", invite.id);
    throw new Error("This invitation has expired");
  }
  if (normalizeEmail(invite.email) !== normalizeEmail(userEmail ?? "")) {
    throw new Error(`This invitation was sent to ${invite.email}. Sign in with that email.`);
  }

  await admin.from("profiles").upsert({ id: userId }, { onConflict: "id" });

  const { data: existing } = await admin
    .from("family_users")
    .select("id, role")
    .eq("family_id", invite.family_id)
    .eq("user_id", userId)
    .limit(1);

  if (!existing || existing.length === 0) {
    const { error } = await admin
      .from("family_users")
      .insert({ family_id: invite.family_id, user_id: userId, role: invite.role });
    if (error) throw error;
  }

  if (invite.status === "pending") {
    await admin
      .from("family_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", invite.id);
  }

  return { family_id: invite.family_id, role: invite.role as HouseholdRole };
}

/** Consumes any pending invitations addressed to this email (used at first sign-in). */
export async function claimPendingInvitations(
  admin: AdminDb,
  userId: string,
  userEmail: string | null,
): Promise<string | null> {
  if (!userEmail) return null;
  const clean = normalizeEmail(userEmail);
  const { data } = await admin
    .from("family_invitations")
    .select("id, family_id, role, expires_at")
    .eq("status", "pending")
    .ilike("email", clean);
  const invites = data ?? [];
  let firstFamily: string | null = null;
  for (const invite of invites) {
    if (new Date(invite.expires_at) < new Date()) {
      await admin.from("family_invitations").update({ status: "expired" }).eq("id", invite.id);
      continue;
    }
    const { data: existing } = await admin
      .from("family_users")
      .select("id")
      .eq("family_id", invite.family_id)
      .eq("user_id", userId)
      .limit(1);
    if (!existing || existing.length === 0) {
      await admin
        .from("family_users")
        .insert({ family_id: invite.family_id, user_id: userId, role: invite.role });
    }
    await admin
      .from("family_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", invite.id);
    firstFamily = firstFamily ?? (invite.family_id as string);
  }
  return firstFamily;
}
