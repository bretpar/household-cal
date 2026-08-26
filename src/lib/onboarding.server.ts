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
    return { family_id: null, family_name: null, members: [], my_member_id: null };
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

  // Internal starter sources: an event bucket and the coverage layer. Neither is
  // a real user calendar, so neither is offered for email summaries.
  await admin.from("calendar_sources").insert([
    {
      family_id: familyId,
      name: "Family",
      display_mode: "events",
      sort_order: 0,
      selectable_in_email: false,
    },
    {
      family_id: familyId,
      name: "Caregiver coverage",
      display_mode: "coverage_background",
      sort_order: 1,
      selectable_in_email: false,
    },
  ]);

  return { family_id: familyId, created: true };
}

/**
 * Replaces the household's calendar members with the onboarding list and links the
 * caller's login to the member they marked as themselves. Owner-only, and only for
 * the household the caller owns.
 */
export async function saveOnboardingMembers(
  admin: Db,
  userId: string,
  members: OnboardingMemberInput[],
): Promise<{ family_id: string; my_member_id: string | null }> {
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

  // idempotent: onboarding owns the initial member list, so replace it wholesale
  await admin.from("family_members").delete().eq("family_id", familyId);

  const { data: inserted, error } = await admin
    .from("family_members")
    .insert(
      members.map((m, index) => ({
        family_id: familyId,
        name: m.name,
        initial: m.initial,
        color: m.color,
        role: m.role,
        access: m.role === "parent" ? "full" : "view_only",
        sort_order: index,
      })),
    )
    .select("id");
  if (error) throw error;

  const meIndex = members.findIndex((m) => m.is_me);
  const myMemberId = meIndex >= 0 ? ((inserted?.[meIndex]?.id as string) ?? null) : null;

  await admin
    .from("family_users")
    .update({ family_member_id: myMemberId })
    .eq("family_id", familyId)
    .eq("user_id", userId);

  return { family_id: familyId, my_member_id: myMemberId };
}
