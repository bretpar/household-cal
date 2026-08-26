/**
 * Developer-only QA reset for the dedicated Parker Family test household.
 *
 * This is deliberately narrow: it only ever touches households whose *every*
 * membership belongs to the hard-coded QA accounts below. Anything else — a real
 * family, a mixed household, an unknown caller — aborts before a single delete.
 *
 * The QA auth users themselves are never created, deleted or modified here.
 */

export type Db = { from: (table: string) => any };
export type AdminDb = Db & {
  auth: {
    admin: {
      listUsers: (opts?: { page?: number; perPage?: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
      }>;
    };
  };
};

/** Only these logins exist inside the QA sandbox. */
export const QA_OWNER_EMAILS = [
  "brendantparker+dad@gmail.com",
  "brendantparker+mom@gmail.com",
] as const;
export const QA_VIEWER_EMAIL = "brendantparker+babysitter@gmail.com";
export const QA_EMAILS = [...QA_OWNER_EMAILS, QA_VIEWER_EMAIL] as const;

export const QA_HOUSEHOLD_NAME = "Parker Family";

/** Names a QA household may legitimately carry before a reset (legacy corruption). */
const QA_HOUSEHOLD_NAMES = new Set([QA_HOUSEHOLD_NAME, "My Family"]);

const BASELINE_MEMBERS = [
  { name: "Dad", initial: "D", color: "sky", role: "parent", access: "full" },
  { name: "Mom", initial: "M", color: "rose", role: "parent", access: "full" },
  { name: "Bailey", initial: "B", color: "amber", role: "child", access: "view_only" },
  { name: "Ellison", initial: "E", color: "sage", role: "child", access: "view_only" },
  { name: "Jack", initial: "J", color: "teal", role: "child", access: "view_only" },
] as const;

const BASELINE_SOURCES = [
  { name: "Family", display_mode: "events", sort_order: 0, selectable_in_email: false },
  {
    name: "Caregiver coverage",
    display_mode: "coverage_background",
    sort_order: 1,
    selectable_in_email: false,
  },
] as const;

export interface QaUserMap {
  byEmail: Map<string, string>;
  ids: Set<string>;
}

export interface QaResetSummary {
  family_id: string;
  family_name: string;
  households_removed: number;
  deleted: {
    events: number;
    activities: number;
    invitations: number;
    calendar_sources: number;
    memberships_removed: number;
  };
  google_calendars_preserved: number;
  memberships: Array<{ email: string; role: string; linked_initial: string | null }>;
  members: string[];
}

export interface QaAuthorization {
  authorized: boolean;
  email: string | null;
  reason?: string;
}

function normalize(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Resolves the QA logins by email. Never creates or mutates auth users. */
export async function loadQaUsers(admin: AdminDb): Promise<QaUserMap> {
  const wanted = new Set<string>(QA_EMAILS.map((e) => normalize(e)));
  const byEmail = new Map<string, string>();
  for (let page = 1; page <= 20; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    for (const u of users) {
      const email = normalize(u.email);
      if (wanted.has(email)) byEmail.set(email, u.id);
    }
    if (users.length < 200 || byEmail.size === wanted.size) break;
  }
  return { byEmail, ids: new Set(byEmail.values()) };
}

/**
 * Authorization: the caller must be signed in as one of the two QA owner logins.
 * The QA viewer and every ordinary user are refused — no client-supplied id is trusted.
 */
export async function authorizeQaCaller(admin: AdminDb, userId: string): Promise<QaAuthorization> {
  const qa = await loadQaUsers(admin);
  const email =
    [...qa.byEmail.entries()].find(([, id]) => id === userId)?.[0] ?? null;
  if (!email) return { authorized: false, email: null, reason: "not a QA test account" };
  if (!QA_OWNER_EMAILS.some((e) => normalize(e) === email)) {
    return { authorized: false, email, reason: "QA reset requires a QA owner account" };
  }
  return { authorized: true, email };
}

/**
 * Candidate households are those a QA account belongs to *and* whose membership
 * list contains nothing but QA accounts. A household shared with any other login
 * is treated as production data and left completely alone.
 */
async function qaHouseholds(admin: AdminDb, qa: QaUserMap): Promise<string[]> {
  const { data: mine, error } = await admin
    .from("family_users")
    .select("family_id")
    .in("user_id", [...qa.ids]);
  if (error) throw error;
  const candidates = [...new Set((mine ?? []).map((r: any) => r.family_id as string))];
  if (candidates.length === 0) return [];

  const { data: rows, error: allErr } = await admin
    .from("family_users")
    .select("family_id, user_id")
    .in("family_id", candidates);
  if (allErr) throw allErr;

  const outsider = new Set<string>();
  for (const r of rows ?? []) {
    if (!qa.ids.has(r.user_id as string)) outsider.add(r.family_id as string);
  }

  const { data: fams, error: famErr } = await admin
    .from("families")
    .select("id, name, created_at")
    .in("id", candidates)
    .order("created_at", { ascending: true });
  if (famErr) throw famErr;

  return (fams ?? [])
    .filter((f: any) => !outsider.has(f.id) && QA_HOUSEHOLD_NAMES.has(f.name))
    .map((f: any) => f.id as string);
}

async function countRows(admin: AdminDb, table: string, familyId: string): Promise<number> {
  const { data } = await admin.from(table).select("id").eq("family_id", familyId);
  return (data ?? []).length;
}

/**
 * Restores the QA baseline. Idempotent: running it twice yields the same single
 * household, the same five members and the same three memberships.
 */
export async function resetQaHousehold(admin: AdminDb, userId: string): Promise<QaResetSummary> {
  const auth = await authorizeQaCaller(admin, userId);
  if (!auth.authorized) throw new Error("QA reset is not available for this account");

  const qa = await loadQaUsers(admin);
  const dadId = qa.byEmail.get(normalize(QA_OWNER_EMAILS[0]));
  const momId = qa.byEmail.get(normalize(QA_OWNER_EMAILS[1]));
  const sitterId = qa.byEmail.get(normalize(QA_VIEWER_EMAIL));
  if (!dadId || !momId || !sitterId) {
    throw new Error("QA reset aborted: the QA test logins are not all present");
  }

  const households = await qaHouseholds(admin, qa);

  // keep the oldest household already named Parker Family, else the oldest QA one
  const { data: named } = await admin
    .from("families")
    .select("id, name, created_at")
    .in("id", households.length > 0 ? households : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: true });
  const keeper =
    (named ?? []).find((f: any) => f.name === QA_HOUSEHOLD_NAME)?.id ??
    (named ?? [])[0]?.id ??
    null;

  let familyId: string;
  let removed = 0;

  if (keeper) {
    familyId = keeper;
    const doomed = households.filter((id) => id !== familyId);
    if (doomed.length > 0) {
      // release the member links first so family_member deletes cannot be blocked
      await admin.from("family_users").update({ family_member_id: null }).in("family_id", doomed);
      const { error } = await admin.from("families").delete().in("id", doomed);
      if (error) throw error;
      removed = doomed.length;
    }
    await admin.from("families").update({ name: QA_HOUSEHOLD_NAME }).eq("id", familyId);
  } else {
    for (const id of [dadId, momId, sitterId]) {
      await admin.from("profiles").upsert({ id }, { onConflict: "id" });
    }
    const { data: created, error } = await admin
      .from("families")
      .insert({ name: QA_HOUSEHOLD_NAME, created_by: dadId })
      .select("id")
      .single();
    if (error) throw error;
    familyId = created.id as string;
  }

  const before = {
    events: await countRows(admin, "events", familyId),
    activities: await countRows(admin, "activities", familyId),
    invitations: await countRows(admin, "family_invitations", familyId),
    calendar_sources: await countRows(admin, "calendar_sources", familyId),
  };

  // user-created test data: events (cascades event_members), activities
  // (cascades activity_members) and every invitation
  for (const table of ["events", "activities", "family_invitations"]) {
    const { error } = await admin.from(table).delete().eq("family_id", familyId);
    if (error) throw error;
  }

  // Google sync configuration is NOT test data: wiping the connected calendar
  // slots silently unlinks the household from Google. Only the local baseline
  // sources are rebuilt; Google slots stay and simply forget their sync cursor
  // so the next pull re-imports the calendar from scratch.
  const { data: googleSources } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("provider", "google");
  const preservedGoogle = (googleSources ?? []).map((s: any) => s.id as string);

  await admin.from("event_sync_links").delete().eq("family_id", familyId);
  const { error: localSourceErr } = await admin
    .from("calendar_sources")
    .delete()
    .eq("family_id", familyId)
    .eq("provider", "local");
  if (localSourceErr) throw localSourceErr;

  if (preservedGoogle.length > 0) {
    await admin
      .from("calendar_sources")
      .update({ google_sync_token: null })
      .in("id", preservedGoogle);
  }

  // baseline calendar sources
  const { error: sourceErr } = await admin
    .from("calendar_sources")
    .insert(BASELINE_SOURCES.map((s) => ({ family_id: familyId, ...s })));
  if (sourceErr) throw sourceErr;

  // baseline family members (rebuilt wholesale so duplicates cannot survive)
  await admin.from("family_users").update({ family_member_id: null }).eq("family_id", familyId);
  await admin.from("family_members").delete().eq("family_id", familyId);
  const { data: insertedMembers, error: memberErr } = await admin
    .from("family_members")
    .insert(
      BASELINE_MEMBERS.map((m, index) => ({ family_id: familyId, ...m, sort_order: index })),
    )
    .select("id, initial");
  if (memberErr) throw memberErr;
  const memberIdBy = new Map<string, string>(
    (insertedMembers ?? []).map((m: any) => [m.initial as string, m.id as string]),
  );

  // baseline memberships (added before pruning so an owner always remains)
  const wanted = [
    { user_id: dadId, role: "owner", family_member_id: memberIdBy.get("D") ?? null },
    { user_id: momId, role: "owner", family_member_id: memberIdBy.get("M") ?? null },
    { user_id: sitterId, role: "viewer", family_member_id: null },
  ];
  for (const m of wanted) {
    await admin.from("profiles").upsert({ id: m.user_id }, { onConflict: "id" });
    const { error } = await admin
      .from("family_users")
      .upsert({ family_id: familyId, ...m }, { onConflict: "family_id,user_id" });
    if (error) throw error;
  }

  const { data: allMemberships } = await admin
    .from("family_users")
    .select("id, user_id")
    .eq("family_id", familyId);
  const stale = (allMemberships ?? []).filter(
    (r: any) => !wanted.some((w) => w.user_id === r.user_id),
  );
  for (const row of stale) {
    const { error } = await admin.from("family_users").delete().eq("id", row.id);
    if (error) throw error;
  }

  // ---- verify the baseline before reporting success ----
  const [{ data: finalMembers }, { data: finalMemberships }, events, activities, invitations] =
    await Promise.all([
      admin.from("family_members").select("initial").eq("family_id", familyId),
      admin.from("family_users").select("user_id, role, family_member_id").eq("family_id", familyId),
      countRows(admin, "events", familyId),
      countRows(admin, "activities", familyId),
      countRows(admin, "family_invitations", familyId),
    ]);

  const initials = (finalMembers ?? []).map((m: any) => m.initial as string).sort();
  if (initials.join("") !== "BDEJM") throw new Error("QA reset failed: member baseline mismatch");
  if (events !== 0 || activities !== 0 || invitations !== 0) {
    throw new Error("QA reset failed: leftover test data");
  }
  const roleOf = new Map<string, any>(
    (finalMemberships ?? []).map((r: any) => [r.user_id as string, r]),
  );
  if (
    (finalMemberships ?? []).length !== 3 ||
    roleOf.get(dadId)?.role !== "owner" ||
    roleOf.get(momId)?.role !== "owner" ||
    roleOf.get(sitterId)?.role !== "viewer" ||
    roleOf.get(dadId)?.family_member_id !== memberIdBy.get("D") ||
    roleOf.get(momId)?.family_member_id !== memberIdBy.get("M")
  ) {
    throw new Error("QA reset failed: membership baseline mismatch");
  }

  const initialById = new Map<string, string>(
    [...memberIdBy.entries()].map(([initial, id]) => [id, initial]),
  );

  return {
    family_id: familyId,
    family_name: QA_HOUSEHOLD_NAME,
    households_removed: removed,
    google_calendars_preserved: preservedGoogle.length,
    deleted: {
      events: before.events,
      activities: before.activities,
      invitations: before.invitations,
      calendar_sources: before.calendar_sources,
      memberships_removed: stale.length,
    },
    memberships: [
      { email: QA_OWNER_EMAILS[0], role: "owner", linked_initial: "D" },
      { email: QA_OWNER_EMAILS[1], role: "owner", linked_initial: "M" },
      { email: QA_VIEWER_EMAIL, role: "viewer", linked_initial: null },
    ],
    members: [...initialById.values()],
  };
}
