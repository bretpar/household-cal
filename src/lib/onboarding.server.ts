/**
 * New-household onboarding.
 *
 * Runs with the service-role client because the very first membership row cannot
 * be inserted through RLS (is_family_owner() has no row to check yet). Every write
 * is scoped to a household the caller demonstrably owns, and the flow is
 * idempotent so a refresh or back-navigation never creates a second household.
 */

export type Db = { from: (table: string) => any };

export type MemberRoleInput = "parent" | "child" | "other";

export interface OnboardingMemberInput {
  id?: string;
  name: string;
  initial: string;
  color: string;
  role: MemberRoleInput;
  /** link the current user's login to this calendar member */
  is_me?: boolean;
}

export interface OnboardingStatus {
  family_id: string | null;
  family_name: string | null;
  members: Array<{ id: string; name: string; initial: string; color: string; role: string }>;
  my_member_id: string | null;
  /** True when a household-less account previously belonged to a household. */
  had_access?: boolean;
}

const COLORS = ["sky", "rose", "amber", "sage", "teal", "lilac", "coral", "sand"];

function cleanColor(color: string): string {
  return COLORS.includes(color) ? color : "sky";
}

function cleanRole(role: string): MemberRoleInput {
  return role === "parent" || role === "child" || role === "other" ? role : "other";
}

export function normalizeMembers(raw: unknown): OnboardingMemberInput[] {
  if (!Array.isArray(raw)) throw new Error("Add at least one family member");
  const members = raw
    .map((m) => {
      const row = (m ?? {}) as Record<string, unknown>;
      const name = String(row["name"] ?? "").trim();
      const initial = String(row["initial"] ?? name.charAt(0))
        .trim()
        .slice(0, 1)
        .toUpperCase();
      return {
        ...(typeof row["id"] === "string" && row["id"].trim() ? { id: row["id"].trim() } : {}),
        name,
        initial,
        color: cleanColor(String(row["color"] ?? "")),
        role: cleanRole(String(row["role"] ?? "")),
        is_me: Boolean(row["is_me"]),
      };
    })
    .filter((m) => m.name.length > 0);
  if (members.length === 0) throw new Error("Add at least one family member");
  for (const m of members) {
    if (!m.initial) throw new Error(`Choose an initial for ${m.name}`);
  }
  return members;
}

/** The household the user already belongs to, if any (their first membership). */
async function firstMembership(
  admin: Db,
  userId: string,
): Promise<{ family_id: string; family_member_id: string | null } | null> {
  const { data, error } = await admin
    .from("family_users")
    .select("family_id, family_member_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? { family_id: row.family_id, family_member_id: row.family_member_id ?? null } : null;
}

export async function loadOnboardingStatus(admin: Db, userId: string): Promise<OnboardingStatus> {
  const membership = await firstMembership(admin, userId);
  if (!membership) {
    // Distinguish a removed member from a brand-new signup (no household data exposed).
    const [inv, fam] = await Promise.all([
      admin.from("family_invitations").select("id").eq("accepted_by", userId).limit(1),
      admin.from("families").select("id").eq("created_by", userId).limit(1),
    ]);
    const had_access = (inv.data?.length ?? 0) > 0 || (fam.data?.length ?? 0) > 0;
    return { family_id: null, family_name: null, members: [], my_member_id: null, had_access };
  }

  const [familyRes, membersRes] = await Promise.all([
    admin.from("families").select("name").eq("id", membership.family_id).single(),
    admin
      .from("family_members")
      .select("id, name, initial, color, role")
      .eq("family_id", membership.family_id)
      .order("sort_order", { ascending: true }),
  ]);

  return {
    family_id: membership.family_id,
    family_name: familyRes.data?.name ?? null,
    members: membersRes.data ?? [],
    my_member_id: membership.family_member_id,
  };
}

/**
 * Creates the household + owner membership + default calendars.
 * If the caller already belongs to a household this resumes it instead of
 * creating another one (refresh / back-navigation safety).
 */
export async function createHousehold(
  admin: Db,
  userId: string,
  name: string,
): Promise<{ family_id: string; created: boolean }> {
  const clean = name.trim();
  if (!clean) throw new Error("Give your household a name");
  if (clean.length > 80) throw new Error("That household name is a bit long");

  const existing = await firstMembership(admin, userId);
  if (existing) {
    // resume: only rename while the household is still empty of members
    const { data: members } = await admin
      .from("family_members")
      .select("id")
      .eq("family_id", existing.family_id)
      .limit(1);
    if (!members || members.length === 0) {
      await admin.from("families").update({ name: clean }).eq("id", existing.family_id);
    }
    return { family_id: existing.family_id, created: false };
  }

  await admin.from("profiles").upsert({ id: userId }, { onConflict: "id" });

  const { data: created, error } = await admin
    .from("families")
    .insert({ name: clean, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  const familyId = created.id as string;

  const { error: memberError } = await admin
    .from("family_users")
    .upsert(
      { family_id: familyId, user_id: userId, role: "owner" },
      { onConflict: "family_id,user_id" },
    );
  if (memberError) throw memberError;

  // Race guard: the existence check above is read-then-write, so two rapid
  // submissions can both create a household. If an earlier membership now
  // exists, discard the one we just made and resume the earlier household.
  const earliest = await firstMembership(admin, userId);
  if (earliest && earliest.family_id !== familyId) {
    await admin.from("family_users").delete().eq("family_id", familyId).eq("user_id", userId);
    await admin.from("families").delete().eq("id", familyId);
    return { family_id: earliest.family_id, created: false };
  }

  // Internal starter source: the local event bucket. It is not a real user
  // calendar, so it is not offered for email summaries.
  await admin.from("calendar_sources").insert([
    {
      family_id: familyId,
      name: "Family",
      calendar_kind: "household_default",
      display_mode: "events",
      sort_order: 0,
      selectable_in_email: false,
    },
  ]);

  return { family_id: familyId, created: true };
}

/**
 * Updates stable members, inserts additions and deletes explicit removals; links the
 * caller's login to the member they marked as themselves. Owner-only, and only for
 * the household the caller owns.
 */
export async function saveOnboardingMembers(
  admin: Db,
  userId: string,
  members: OnboardingMemberInput[],
  removedMemberIds: string[] = [],
): Promise<{ family_id: string; my_member_id: string | null; member_ids: string[] }> {
  const membership = await firstMembership(admin, userId);
  if (!membership) throw new Error("Create your household first");

  const { data: roleRow } = await admin
    .from("family_users")
    .select("role")
    .eq("family_id", membership.family_id)
    .eq("user_id", userId)
    .limit(1);
  if (roleRow?.[0]?.role !== "owner") throw new Error("Only household owners can do that");

  const familyId = membership.family_id;
  const { data: existing, error: existingError } = await admin
    .from("family_members")
    .select("id, role")
    .eq("family_id", familyId);
  if (existingError) throw existingError;
  const byId = new Map<string, { id: string; role: string }>((existing ?? []).map((m: { id: string; role: string }) => [m.id, m]));
  const submittedIds = members.flatMap((m) => m.id ? [m.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length ||
      [...submittedIds, ...removedMemberIds].some((id) => !byId.has(id)) ||
      removedMemberIds.some((id) => submittedIds.includes(id))) {
    throw new Error("Family members changed. Reload setup and try again.");
  }

  const memberIds: string[] = [];
  for (const [index, m] of members.entries()) {
    const fields = { name: m.name, initial: m.initial, color: m.color, sort_order: index };
    if (m.id) {
      // Existing access and caregiver-specific fields are not onboarding's to reset.
      const previous = byId.get(m.id);
      const role = previous && ["parent", "child", "other"].includes(previous.role) ? { role: m.role } : {};
      const { error } = await admin.from("family_members").update({ ...fields, ...role })
        .eq("family_id", familyId).eq("id", m.id);
      if (error) throw error;
      memberIds.push(m.id);
    } else {
      const { data: added, error } = await admin.from("family_members")
        .insert({ ...fields, family_id: familyId, role: m.role, access: m.role === "parent" ? "full" : "view_only" })
        .select("id").single();
      if (error) throw error;
      memberIds.push(added.id as string);
    }
  }
  if (removedMemberIds.length > 0) {
    const { error } = await admin.from("family_members").delete().eq("family_id", familyId).in("id", removedMemberIds);
    if (error) throw error;
  }

  const meIndex = members.findIndex((m) => m.is_me);
  const myMemberId = meIndex >= 0 ? (memberIds[meIndex] ?? null) :
    (membership.family_member_id && !removedMemberIds.includes(membership.family_member_id) ? membership.family_member_id : null);

  const { error: linkError } = await admin
    .from("family_users")
    .update({ family_member_id: myMemberId })
    .eq("family_id", familyId)
    .eq("user_id", userId);
  if (linkError) throw linkError;

  return { family_id: familyId, my_member_id: myMemberId, member_ids: memberIds };
}
