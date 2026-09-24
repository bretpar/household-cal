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
  rpc: (fn: string, args: Record<string, unknown>) => Promise<Res>;
  auth: {
    admin: {
      updateUserById: (id: string, attrs: { ban_duration: string }) => Promise<{ error: any }>;
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
  transfers?: Record<string, string> | undefined;
  /** family_ids the user explicitly confirmed deleting (sole member only) */
  delete_households?: string[] | undefined;
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
  /** Reads a household's Google connection key (held in memory only). */
  readGoogleKey?: (familyId: string) => Promise<string | null>;
  /** Revokes a Google connection remotely, given its key. */
  revokeGoogle?: (connectionKey: string) => Promise<unknown>;
}

export type DeleteAccountResult =
  | { ok: true; google_revoke_failures: number }
  | { ok: false; plans: HouseholdDeletionPlan[] }
  | { ok: false; pending: true };

const BAN = "876000h"; // ~100 years; the account is about to be deleted

async function setJob(db: DeletionDb, userId: string, patch: Record<string, unknown>) {
  await db.from("account_deletion_jobs").upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

const MAX_ATTEMPTS = 50;
/** An attempt older than this with no running database step is abandoned. */
const LEASE_MS = 15 * 60 * 1000;

/**
 * Recovers abandoned "pending" jobs. The database step refuses (SKIP LOCKED)
 * while a deletion transaction holds the job, and refuses before the lease
 * expires. A pending job can only be rolled back when nothing was committed,
 * because data removal and the "data_removed" status commit together.
 * Sign-in is restored only after the database confirmed the rollback; a failed
 * restore is retried on the next run (sign_in_restored = false).
 */
export async function recoverStalePendingDeletions(
  db: DeletionDb,
  onlyUserId?: string,
): Promise<{ recovered: number; restored: number }> {
  let q = db.from("account_deletion_jobs").select("user_id").eq("status", "pending");
  if (onlyUserId) q = q.eq("user_id", onlyUserId);
  const { data, error } = await q.limit(20);
  if (error) throw new Error(`load pending jobs: ${sanitize(error)}`);
  let recovered = 0;
  for (const job of (data ?? []) as { user_id: string }[]) {
    const r = await db.rpc("recover_stale_account_deletion", { _user_id: job.user_id });
    if (!r.error && r.data === "rolled_back") recovered += 1;
  }
  let rq = db
    .from("account_deletion_jobs")
    .select("user_id")
    .eq("status", "rolled_back")
    .eq("sign_in_restored", false);
  if (onlyUserId) rq = rq.eq("user_id", onlyUserId);
  const pendingRestore = await rq.limit(20);
  let restored = 0;
  for (const job of (pendingRestore.data ?? []) as { user_id: string }[]) {
    const un = await db.auth.admin.updateUserById(job.user_id, { ban_duration: "none" });
    if (un.error && !isUserNotFound(un.error)) continue;
    await db
      .from("account_deletion_jobs")
      .update({ sign_in_restored: true })
      .eq("user_id", job.user_id)
      .eq("status", "rolled_back");
    restored += 1;
  }
  return { recovered, restored };
}

/** Short, credential-free failure text safe to store. */
export function sanitize(value: unknown): string {
  return String((value as any)?.message ?? value ?? "unknown")
    .replace(/(eyJ[\w-]+\.[\w-]+\.[\w-]+)|(sb_[a-z]+_[\w-]+)|(Bearer\s+\S+)/gi, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .slice(0, 200);
}

function isUserNotFound(error: any): boolean {
  return error?.status === 404 || /not.?found/i.test(String(error?.message ?? ""));
}

/**
 * Flow (each step is safe to repeat):
 *  1. Preflight plan (UX only; the database step re-validates under lock).
 *  2. Record a deletion job and block new sign-ins for the account.
 *  3. Read Google keys of households to be deleted into memory.
 *  4. One database transaction: lock households, re-check owners/members,
 *     transfer/remove/delete, clean personal rows. On refusal or error nothing
 *     changed, so sign-in is unblocked and the user sees the reason.
 *  5. Best-effort remote Google revoke with the in-memory keys (local
 *     credentials are already gone via cascade; failures are only counted).
 *  6. Delete the auth user. If that fails, the account stays blocked and the
 *     job stays "data_removed" for the scheduled retry.
 */
export async function deleteAccount(
  db: DeletionDb,
  userId: string,
  request: DeletionRequest,
  options: DeleteAccountOptions = {},
): Promise<DeleteAccountResult> {
  const plans = await planAccountDeletion(db, userId, request);
  if (!isPlanReady(plans)) return { ok: false, plans };

  const email = (await db.auth.admin.getUserById(userId)).data.user?.email ?? null;
  await setJob(db, userId, {
    status: "pending",
    last_error: null,
    attempt_id: crypto.randomUUID(),
    lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(),
    sign_in_restored: true,
  });
  const ban = await db.auth.admin.updateUserById(userId, { ban_duration: BAN });
  if (ban.error) throw new Error(`block sign-in: ${ban.error.message ?? ban.error}`);

  const unblock = async (reason: string) => {
    await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
    await setJob(db, userId, { status: "rolled_back", last_error: sanitize(reason) });
  };

  const keys: string[] = [];
  if (options.readGoogleKey) {
    for (const p of plans) {
      if (p.action.kind !== "delete_household") continue;
      try {
        const k = await options.readGoogleKey(p.family_id);
        if (k) keys.push(k);
      } catch (error) {
        console.error("[account-deletion] could not read google key", error);
      }
    }
  }

  let rpc: Res;
  try {
    rpc = await db.rpc("delete_account_data", {
      _user_id: userId,
      _email: email,
      _transfers: request.transfers ?? {},
      _delete_households: request.delete_households ?? [],
    });
  } catch (error) {
    await unblock(String((error as Error)?.message ?? error));
    throw error;
  }
  if (rpc.error) {
    await unblock(String(rpc.error.message ?? rpc.error));
    throw new Error("Could not delete your account. Nothing was changed; please try again.");
  }
  if (!rpc.data?.ok) {
    await unblock(String(rpc.data?.reason ?? "refused"));
    return { ok: false, plans: await planAccountDeletion(db, userId, request) };
  }

  let failures = 0;
  if (options.revokeGoogle) {
    for (const key of keys) {
      try {
        await withTimeout(Promise.resolve(options.revokeGoogle(key)), 8000);
      } catch (error) {
        failures += 1;
        console.error("[account-deletion] google remote revoke failed", error);
      }
    }
  }
  keys.length = 0;

  const del = await db.auth.admin.deleteUser(userId);
  if (del.error && !isUserNotFound(del.error)) {
    await setJob(db, userId, {
      status: "data_removed",
      last_error: sanitize(del.error),
      google_revoke_failures: failures,
    });
    return { ok: false, pending: true };
  }
  await setJob(db, userId, { status: "completed", last_error: null, google_revoke_failures: failures });
  return { ok: true, google_revoke_failures: failures };
}

/**
 * Scheduled retry for accounts whose data was removed but auth deletion failed.
 * The auth user is only deleted when the cleanup RPC explicitly returned ok and
 * the job is still "data_removed". After MAX_ATTEMPTS the job becomes "failed"
 * (still blocking access) until an administrator re-queues it.
 */
export async function retryPendingAccountDeletions(
  db: DeletionDb,
): Promise<{ retried: number; completed: number; exhausted: number }> {
  const { data, error } = await db
    .from("account_deletion_jobs")
    .select("user_id, attempts, status")
    .eq("status", "data_removed")
    .limit(20);
  if (error) throw new Error(`load deletion jobs: ${sanitize(error)}`);
  let completed = 0;
  let exhausted = 0;
  for (const job of (data ?? []) as { user_id: string; attempts: number; status: string }[]) {
    const attempts = job.attempts + 1;
    let failure: string | null = null;
    try {
      const rpc = await db.rpc("delete_account_data", {
        _user_id: job.user_id,
        _email: null,
        _transfers: {},
        _delete_households: [],
      });
      if (rpc.error || rpc.data?.ok !== true) {
        failure = `cleanup: ${sanitize(rpc.error ?? rpc.data?.reason ?? "not ok")}`;
      } else {
        const recheck = await db
          .from("account_deletion_jobs")
          .select("status")
          .eq("user_id", job.user_id)
          .maybeSingle();
        if (recheck.error || recheck.data?.status !== "data_removed") {
          failure = "job state changed";
        } else {
          const del = await db.auth.admin.deleteUser(job.user_id);
          if (del.error && !isUserNotFound(del.error)) failure = `auth: ${sanitize(del.error)}`;
        }
      }
    } catch (e) {
      failure = sanitize(e);
    }
    const status = failure === null ? "completed" : attempts >= MAX_ATTEMPTS ? "failed" : "data_removed";
    await db
      .from("account_deletion_jobs")
      .update({ status, attempts, last_error: failure })
      .eq("user_id", job.user_id)
      .eq("status", "data_removed");
    if (failure === null) completed += 1;
    else if (status === "failed") exhausted += 1;
  }
  return { retried: data?.length ?? 0, completed, exhausted };
}

/**
 * Administrative re-queue for an exhausted ("failed") job, after the underlying
 * problem is fixed. Never restores access: the job goes back to "data_removed"
 * and deletion is retried immediately.
 */
export async function requeueFailedAccountDeletion(db: DeletionDb, userId: string) {
  const { data, error } = await db
    .from("account_deletion_jobs")
    .update({ status: "data_removed", attempts: 0 })
    .eq("user_id", userId)
    .eq("status", "failed")
    .select("user_id");
  if (error) throw new Error(`requeue: ${sanitize(error)}`);
  if (!data?.length) return { requeued: false as const };
  return { requeued: true as const, ...(await retryPendingAccountDeletions(db)) };
}
