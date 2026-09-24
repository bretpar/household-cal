/**
 * Apple-compliant in-app account deletion.
 *
 * Server-only. Callers pass the authenticated user id from requireSupabaseAuth
 * and a service-role client; the browser never supplies a user id.
 *
 * Per household the deleting user belongs to:
 *  - not an owner, or another owner exists  -> remove only their membership
 *  - sole owner with other members          -> require a transfer target, promote
 *                                              them to owner, then remove membership
 *  - sole owner and sole member             -> require explicit household-delete
 *                                              confirmation, then delete the family
 *                                              (existing cascades remove its data)
 */

type Res = { data: any; error: any };
export type DeletionDb = {
  from: (table: string) => any;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } }>;
      deleteUser: (id: string) => Promise<{ error: any }>;
    };
  };
};

export type HouseholdDeletionAction =
  | { kind: "leave" }
  | { kind: "needs_transfer"; candidates: { user_id: string; label: string }[] }
  | { kind: "transfer"; to_user_id: string }
  | { kind: "delete_household" }
  | { kind: "needs_delete_confirmation" };

export interface HouseholdDeletionPlan {
  family_id: string;
  family_name: string;
  role: string;
  action: HouseholdDeletionAction;
}

export interface DeletionRequest {
  /** family_id -> user_id of the member to promote to owner */
  transfers?: Record<string, string>;
  /** family_ids the user explicitly confirmed deleting (sole member only) */
  delete_households?: string[];
}

function check(res: Res, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? res.error}`);
  return res.data;
}

async function labelFor(db: DeletionDb, userId: string): Promise<string> {
  const p = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const name = p.data?.display_name;
  if (name) return name;
  const u = await db.auth.admin.getUserById(userId);
  return u.data.user?.email ?? "Household member";
}

/** Builds the per-household plan. Never mutates. */
export async function planAccountDeletion(
  db: DeletionDb,
  userId: string,
  request: DeletionRequest = {},
): Promise<HouseholdDeletionPlan[]> {
  const mine = check(
    await db.from("family_users").select("family_id, role, families(name)").eq("user_id", userId),
    "load memberships",
  ) as { family_id: string; role: string; families: { name: string } | null }[];

  const plans: HouseholdDeletionPlan[] = [];
  for (const m of mine) {
    const others = check(
      await db
        .from("family_users")
        .select("user_id, role")
        .eq("family_id", m.family_id)
        .neq("user_id", userId),
      "load household members",
    ) as { user_id: string; role: string }[];
    const base = { family_id: m.family_id, family_name: m.families?.name ?? "Household", role: m.role };

    if (m.role !== "owner" || others.some((o) => o.role === "owner")) {
      plans.push({ ...base, action: { kind: "leave" } });
      continue;
    }
    if (others.length === 0) {
      const confirmed = request.delete_households?.includes(m.family_id);
      plans.push({ ...base, action: confirmed ? { kind: "delete_household" } : { kind: "needs_delete_confirmation" } });
      continue;
    }
    const target = request.transfers?.[m.family_id];
    if (target && target !== userId && others.some((o) => o.user_id === target)) {
      plans.push({ ...base, action: { kind: "transfer", to_user_id: target } });
      continue;
    }
    const candidates = await Promise.all(
      others.map(async (o) => ({ user_id: o.user_id, label: await labelFor(db, o.user_id) })),
    );
    plans.push({ ...base, action: { kind: "needs_transfer", candidates } });
  }
  return plans;
}

export function isPlanReady(plans: HouseholdDeletionPlan[]): boolean {
  return plans.every(
    (p) => p.action.kind === "leave" || p.action.kind === "transfer" || p.action.kind === "delete_household",
  );
}

export interface DeleteAccountOptions {
  /** Revokes the household's Google connection before the household is deleted. */
  revokeGoogle?: (familyId: string) => Promise<unknown>;
}

export async function deleteAccount(
  db: DeletionDb,
  userId: string,
  request: DeletionRequest,
  options: DeleteAccountOptions = {},
): Promise<{ ok: true } | { ok: false; plans: HouseholdDeletionPlan[] }> {
  const plans = await planAccountDeletion(db, userId, request);
  if (!isPlanReady(plans)) return { ok: false, plans };

  const email = (await db.auth.admin.getUserById(userId)).data.user?.email?.trim().toLowerCase() ?? null;

  // 1. Household memberships.
  for (const p of plans) {
    if (p.action.kind === "delete_household") {
      if (options.revokeGoogle) {
        try {
          await options.revokeGoogle(p.family_id);
        } catch (error) {
          console.error("[account-deletion] google revoke failed", error);
        }
      }
      check(await db.from("families").delete().eq("id", p.family_id), "delete household");
      continue;
    }
    if (p.action.kind === "transfer") {
      check(
        await db
          .from("family_users")
          .update({ role: "owner" })
          .eq("family_id", p.family_id)
          .eq("user_id", p.action.to_user_id),
        "transfer ownership",
      );
    }
    check(
      await db.from("family_users").delete().eq("family_id", p.family_id).eq("user_id", userId),
      "remove membership",
    );
  }

  // 2. Personal references in surviving households.
  const nullRefs: [string, string][] = [
    ["email_schedules", "created_by"],
    ["events", "created_by"],
    ["families", "created_by"],
    ["google_connections", "connected_by"],
    ["family_invitations", "invited_by"],
    ["family_invitations", "accepted_by"],
  ];
  for (const [table, column] of nullRefs) {
    check(await db.from(table).update({ [column]: null }).eq(column, userId), `clear ${table}.${column}`);
  }

  // 3. Personal rows.
  check(await db.from("email_schedule_recipients").delete().eq("user_id", userId), "remove email recipients");
  check(await db.from("native_auth_handoffs").delete().eq("user_id", userId), "remove auth handoffs");
  check(await db.from("user_preferences").delete().eq("user_id", userId), "remove preferences");
  check(await db.from("profiles").delete().eq("id", userId), "remove profile");
  if (email) {
    check(
      await db.from("family_invitations").delete().eq("status", "pending").ilike("email", email),
      "remove pending invitations",
    );
  }

  // 4. Auth user last.
  const del = await db.auth.admin.deleteUser(userId);
  if (del.error) throw new Error(`delete auth user: ${del.error.message ?? del.error}`);
  return { ok: true };
}
