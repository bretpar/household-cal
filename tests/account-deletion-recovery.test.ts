import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  deleteAccount,
  listLegacyRecoveryCandidates,
  recoverStalePendingDeletions,
  restoreLegacyRolledBackSignIn,
  requeueFailedAccountDeletion,
  retryPendingAccountDeletions,
  type DeletionDb,
} from "../src/lib/account-deletion.server";

type Row = Record<string, any>;
const BAN_MS = 876000 * 3600 * 1000;

function fake(opts: {
  jobs?: Row[];
  users?: Record<string, { banned_until: string | null }>;
  rpc?: (fn: string) => any;
  jobWriteError?: (operation: "upsert" | "update", patch: Row) => string | null;
} = {}) {
  const jobs: Row[] = opts.jobs ?? [];
  const users = opts.users ?? {};
  const calls = { unban: 0, ban: 0, rpc: [] as string[] };
  const table = (name: string) => {
    const filters: [string, string, any][] = [];
    let patch: Row | null = null;
    const rows = () =>
      name === "account_deletion_jobs"
        ? jobs.filter((r) => filters.every(([op, k, v]) => (op === "is" ? (r[k] ?? null) === v : r[k] === v)))
        : [];
    const b: any = {
      select: () => b,
      eq: (k: string, v: any) => (filters.push(["eq", k, v]), b),
      is: (k: string, v: any) => (filters.push(["is", k, v]), b),
      neq: () => b,
      limit: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
      update: (p: Row) => ((patch = p), b),
      upsert: (p: Row) => {
        const writeError = opts.jobWriteError?.("upsert", p);
        if (writeError) return Promise.resolve({ error: { message: writeError } });
        const ex = jobs.find((j) => j.user_id === p["user_id"]);
        if (ex) Object.assign(ex, p);
        else jobs.push({ ban_provenance: null, ...p });
        return Promise.resolve({ error: null });
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const run = () => {
      const writeError = patch ? opts.jobWriteError?.("update", patch) : null;
      if (writeError) return { data: [] as Row[], error: { message: writeError } };
      const r = rows();
      if (patch) r.forEach((x) => Object.assign(x, patch));
      return { data: name === "family_users" ? [] : r, error: null };
    };
    return b;
  };
  const db: DeletionDb = {
    from: table,
    rpc: async (fn) => (calls.rpc.push(fn), opts.rpc ? opts.rpc(fn) : { data: null, error: null }),
    auth: {
      admin: {
        getUserById: async (id) => ({ data: { user: users[id] ? { email: null, ...users[id] } : null }, error: users[id] ? null : { status: 404 } }),
        updateUserById: async (id, a) => {
          if (a.ban_duration === "none") { calls.unban++; users[id]!.banned_until = null; }
          else { calls.ban++; users[id]!.banned_until = new Date(Date.now() + BAN_MS).toISOString(); }
          return { data: { user: { banned_until: users[id]!.banned_until } }, error: null };
        },
        deleteUser: async () => ({ error: null }),
      },
    },
  };
  return { db, jobs, users, calls };
}

const future = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("account deletion recovery provenance", () => {
  it("A: rollback of a deletion-applied ban is restored automatically", async () => {
    const f = fake({ users: { u: { banned_until: null } }, rpc: () => ({ data: { ok: false, reason: "refused" }, error: null }) });
    await deleteAccount(f.db, "u", {});
    // Simulate a failed unban during rollback.
    f.jobs[0]!.sign_in_restored = false;
    const ownedExpiry = future(BAN_MS);
    f.users["u"]!.banned_until = ownedExpiry;
    f.jobs[0]!.deletion_ban_applied_at = new Date().toISOString();
    f.jobs[0]!.deletion_ban_expires_at = ownedExpiry;
    const r = await recoverStalePendingDeletions(f.db);
    expect(r.restored).toBe(1);
    expect(f.users["u"]!.banned_until).toBeNull();
    expect(f.jobs[0]!.sign_in_restored).toBe(true);
  });

  it("B: a ban that existed before deletion is preserved on rollback", async () => {
    const original = future(3600_000);
    const f = fake({ users: { u: { banned_until: original } }, rpc: () => ({ data: { ok: false }, error: null }) });
    await deleteAccount(f.db, "u", {});
    expect(f.calls.ban).toBe(0);
    expect(f.calls.unban).toBe(0);
    expect(f.jobs[0]!.ban_provenance).toBe("preexisting");
    f.jobs[0]!.sign_in_restored = false; // e.g. stale-pending rollback
    await recoverStalePendingDeletions(f.db);
    expect(f.users["u"]!.banned_until).toBe(original);
  });

  it("C: legacy restored-but-banned job is listed for review, not unbanned", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: true, ban_provenance: null }],
      users: { u: { banned_until: future(BAN_MS) } },
    });
    await recoverStalePendingDeletions(f.db);
    await recoverStalePendingDeletions(f.db, "u");
    expect(f.calls.unban).toBe(0);
    expect((await listLegacyRecoveryCandidates(f.db)).map((c) => c.user_id)).toEqual(["u"]);
    expect(await restoreLegacyRolledBackSignIn(f.db, "u")).toEqual({ restored: true });
    expect(f.calls.unban).toBe(1);
  });

  it("D/E: completed and data_removed jobs are never restored", async () => {
    for (const status of ["completed", "data_removed", "failed"]) {
      const f = fake({
        jobs: [{ user_id: "u", status, sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date().toISOString() }],
        users: { u: { banned_until: future(BAN_MS) } },
      });
      await recoverStalePendingDeletions(f.db, "u");
      expect(await restoreLegacyRolledBackSignIn(f.db, "u")).toMatchObject({ restored: false });
      expect(f.calls.unban).toBe(0);
    }
  });

  it("F: a replacement administrative ban is never lifted", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date(Date.now() - 86400_000 * 30).toISOString(), deletion_ban_expires_at: future(BAN_MS - 3600_000) }],
      users: { u: { banned_until: future(BAN_MS) } },
    });
    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(0);
    expect(f.jobs[0]!.ban_provenance).toBe("superseded");
  });

  it("does not lift a replacement ban only two hours beyond the deletion expiry", async () => {
    const deletionExpiry = future(BAN_MS);
    const replacementExpiry = new Date(Date.parse(deletionExpiry) + 2 * 3600_000).toISOString();
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date().toISOString(), deletion_ban_expires_at: deletionExpiry }],
      users: { u: { banned_until: replacementExpiry } },
    });

    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(0);
    expect(f.users["u"]!.banned_until).toBe(replacementExpiry);
    expect(f.jobs[0]).toMatchObject({ ban_provenance: "superseded", restoration_reason: "superseded_ban_preserved" });
  });

  it("leaves an ambiguous ban unchanged and surfaces unresolved ownership", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date().toISOString(), deletion_ban_expires_at: null }],
      users: { u: { banned_until: future(BAN_MS) } },
    });

    await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("deletion ban ownership unresolved");
    expect(f.calls.unban).toBe(0);
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion" });
  });

  it("G: repeated recovery is idempotent and never re-runs cleanup", async () => {
    const ownedExpiry = future(BAN_MS);
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date().toISOString(), deletion_ban_expires_at: ownedExpiry }],
      users: { u: { banned_until: ownedExpiry } },
    });
    await recoverStalePendingDeletions(f.db);
    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(1);
    expect(f.calls.rpc).not.toContain("delete_account_data");
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: true, ban_provenance: "deletion" });
  });
  it("immediate rollback keeps a ban that replaced the deletion ban", async () => {
    const replacement = future(3600_000);
    const f = fake({ users: { u: { banned_until: null } } });
    f.db.rpc = async () => {
      f.users["u"]!.banned_until = replacement; // superseding ban before rollback
      return { data: { ok: false, reason: "refused" }, error: null };
    };
    await deleteAccount(f.db, "u", {});
    expect(f.calls.ban).toBe(1);
    expect(f.calls.unban).toBe(0);
    expect(f.users["u"]!.banned_until).toBe(replacement);
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", ban_provenance: "superseded", sign_in_restored: true });
    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(0);
  });
  it("immediate rollback defers restoration when the Auth lookup is unreliable", async () => {
    for (const failure of ["returned_error", "thrown_error", "missing_user"]) {
      const f = fake({ users: { u: { banned_until: null } } });
      const getUser = f.db.auth.admin.getUserById;
      f.db.rpc = async (fn) => {
        f.calls.rpc.push(fn);
        f.db.auth.admin.getUserById = async () => {
          if (failure === "thrown_error") throw new Error("Auth unavailable");
          return { data: { user: null }, error: failure === "returned_error" ? { message: "Auth unavailable" } : null };
        };
        return { data: { ok: false, reason: "refused" }, error: null };
      };
      await deleteAccount(f.db, "u", {});
      expect(f.calls.unban).toBe(0);
      expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion" });
      expect(f.users["u"]?.banned_until).not.toBeNull();
      f.db.auth.admin.getUserById = getUser;
      await recoverStalePendingDeletions(f.db);
      await recoverStalePendingDeletions(f.db);
      expect(f.calls.unban).toBe(1);
      expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: true, ban_provenance: "deletion" });
      expect(f.calls.rpc.filter((fn) => fn === "delete_account_data")).toHaveLength(1);
    }
  });
  it("immediate rollback completes restoration without unbanning when no active ban remains", async () => {
    for (const until of [null, new Date(Date.now() - 3600_000).toISOString()]) {
      const f = fake({ users: { u: { banned_until: null } } });
      f.db.rpc = async (fn) => {
        f.calls.rpc.push(fn);
        const user = f.users["u"];
        if (!user) throw new Error("Missing test user");
        user.banned_until = until;
        return { data: { ok: false, reason: "refused" }, error: null };
      };
      await deleteAccount(f.db, "u", {});
      expect(f.calls.unban).toBe(0);
      expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: true, ban_provenance: "deletion" });
      expect(f.users["u"]?.banned_until).toBe(until);
      await recoverStalePendingDeletions(f.db);
      expect(f.calls.unban).toBe(0);
      expect(f.calls.rpc.filter((fn) => fn === "delete_account_data")).toHaveLength(1);
    }
  });

});

describe("account deletion audit trail", () => {
  const recent = () => new Date().toISOString();
  const restoredJob = (provenance: string | null, until: string | null, applied = recent(), recordedExpiry = until) => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: provenance, deletion_ban_applied_at: applied, deletion_ban_expires_at: provenance === "deletion" ? recordedExpiry : null }],
      users: { u: { banned_until: until } },
    });
    return f;
  };

  it("stale recovery SQL preserves attempt_id and stamps rolled_back_at", () => {
    const sql = readFileSync("drizzle/migrations/0066_account_deletion_audit_trail.sql", "utf8");
    const fn = sql.slice(sql.indexOf("recover_stale_account_deletion"));
    expect(fn).not.toMatch(/attempt_id\s*=\s*NULL/i);
    expect(fn).toMatch(/rolled_back_at\s*=\s*now\(\)/i);
  });

  it("records the reason for each recovery branch", async () => {
    const cases: [ReturnType<typeof fake>, string][] = [
      [restoredJob("deletion", future(BAN_MS)), "deletion_ban_lifted"],
      [restoredJob("preexisting", future(3600_000)), "preexisting_ban_preserved"],
      [restoredJob("deletion", future(BAN_MS), recent(), future(BAN_MS - 3600_000)), "superseded_ban_preserved"],
      [restoredJob("deletion", null), "user_not_banned"],
    ];
    for (const [f, reason] of cases) {
      await recoverStalePendingDeletions(f.db);
      expect(f.jobs[0]).toMatchObject({ sign_in_restored: true, restoration_reason: reason });
      expect(f.jobs[0]!.sign_in_restored_at).toEqual(expect.any(String));
    }
  });

  it("immediate rollback stamps rolled_back_at and the lift reason", async () => {
    const f = fake({ users: { u: { banned_until: null } }, rpc: () => ({ data: { ok: false, reason: "refused" }, error: null }) });
    await deleteAccount(f.db, "u", {});
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", restoration_reason: "deletion_ban_lifted" });
    expect(f.jobs[0]!.rolled_back_at).toEqual(expect.any(String));
    expect(f.jobs[0]!.sign_in_restored_at).toEqual(expect.any(String));
  });

  it("deferred restoration leaves no restored timestamp", async () => {
    const f = fake({ users: { u: { banned_until: null } } });
    f.db.rpc = async () => {
      f.db.auth.admin.getUserById = async () => ({ data: { user: null }, error: { message: "down" } });
      return { data: { ok: false }, error: null };
    };
    await deleteAccount(f.db, "u", {});
    expect(f.jobs[0]).toMatchObject({ sign_in_restored: false, sign_in_restored_at: null, restoration_reason: null });
  });

  it("successful deletion stamps completed_at", async () => {
    const f = fake({ users: { u: { banned_until: null } }, rpc: () => ({ data: { ok: true }, error: null }) });
    await deleteAccount(f.db, "u", {});
    expect(f.jobs[0]).toMatchObject({ status: "completed" });
    expect(f.jobs[0]!.completed_at).toEqual(expect.any(String));
  });

  it("manual operator restore records manual_operator_restore", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: true, ban_provenance: null }],
      users: { u: { banned_until: future(BAN_MS) } },
    });
    await restoreLegacyRolledBackSignIn(f.db, "u");
    expect(f.jobs[0]).toMatchObject({ restoration_reason: "manual_operator_restore" });
    expect(f.jobs[0]!.sign_in_restored_at).toEqual(expect.any(String));
  });

  it("requeue preserves prior exhaustion context", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "failed", attempts: 50, last_error: "auth: boom", requeue_count: 0 }],
      users: {},
      rpc: () => ({ data: { ok: false, reason: "x" }, error: null }),
    });
    await requeueFailedAccountDeletion(f.db, "u");
    expect(f.jobs[0]).toMatchObject({ attempts_before_requeue: 50, error_before_requeue: "auth: boom", requeue_count: 1 });
    expect(f.jobs[0]!.last_requeued_at).toEqual(expect.any(String));
  });
});

describe("account deletion job persistence", () => {
  it("recovers other accounts after an unresolved ban, including on repeated runs", async () => {
    const expiry = future(BAN_MS);
    const f = fake({
      jobs: [
        { user_id: "stuck", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_expires_at: null },
        { user_id: "ready", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_expires_at: expiry },
      ],
      users: { stuck: { banned_until: expiry }, ready: { banned_until: expiry } },
    });
    for (let run = 0; run < 2; run++) {
      await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("deletion ban ownership unresolved");
      expect(f.users["stuck"]?.banned_until).toBe(expiry);
      expect(f.users["ready"]?.banned_until).toBeNull();
      expect(f.jobs[0]).toMatchObject({ sign_in_restored: false });
      expect(f.jobs[1]).toMatchObject({ sign_in_restored: true });
    }
    expect(f.calls.unban).toBe(1);
  });

  it("continues pending transitions and restorations after a returned or thrown RPC error", async () => {
    for (const failure of ["returned", "thrown"]) {
      const expiry = future(BAN_MS);
      const jobs = ["stuck", "ready"].map((user_id) => ({
        user_id, status: "pending", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_expires_at: expiry,
      }));
      const f = fake({ jobs, users: { stuck: { banned_until: expiry }, ready: { banned_until: expiry } } });
      f.db.rpc = async (_fn, args) => {
        if (args["_user_id"] === "stuck") {
          if (failure === "thrown") throw new Error("transition unavailable");
          return { data: null, error: { message: "transition unavailable" } };
        }
        const ready = jobs[1];
        if (!ready) throw new Error("Missing ready job");
        ready.status = "rolled_back";
        return { data: "rolled_back", error: null };
      };
      await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("transition unavailable");
      expect(jobs[0]).toMatchObject({ status: "pending", sign_in_restored: false });
      expect(jobs[1]).toMatchObject({ status: "rolled_back", sign_in_restored: true });
      expect(f.users["stuck"]?.banned_until).toBe(expiry);
      expect(f.users["ready"]?.banned_until).toBeNull();
    }
  });

  it("continues restoring other accounts after a recovery persistence failure", async () => {
    const expiry = future(BAN_MS);
    const f = fake({
      jobs: [
        { user_id: "stuck", status: "rolled_back", sign_in_restored: false, ban_provenance: "preexisting" },
        { user_id: "ready", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_expires_at: expiry },
      ],
      users: { stuck: { banned_until: expiry }, ready: { banned_until: expiry } },
      jobWriteError: (_operation, patch) => patch["restoration_reason"] === "preexisting_ban_preserved" ? "recovery write unavailable" : null,
    });
    await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("recovery write unavailable");
    expect(f.users["stuck"]?.banned_until).toBe(expiry);
    expect(f.jobs[0]).toMatchObject({ sign_in_restored: false });
    expect(f.users["ready"]?.banned_until).toBeNull();
    expect(f.jobs[1]).toMatchObject({ sign_in_restored: true });
  });

  it("stops before banning when the initial recovery job cannot be persisted", async () => {
    const f = fake({
      users: { u: { banned_until: null } },
      jobWriteError: (operation, patch) =>
        operation === "upsert" && patch["status"] === "pending" ? "job storage unavailable" : null,
    });

    await expect(deleteAccount(f.db, "u", {})).rejects.toThrow("record deletion job: job storage unavailable");
    expect(f.calls.ban).toBe(0);
    expect(f.calls.unban).toBe(0);
    expect(f.calls.rpc).toEqual([]);
    expect(f.jobs).toEqual([]);
    expect(f.users["u"]!.banned_until).toBeNull();
  });

  it("surfaces an immediate rollback job write failure", async () => {
    const f = fake({
      users: { u: { banned_until: null } },
      rpc: () => ({ data: { ok: false, reason: "refused" }, error: null }),
      jobWriteError: (operation, patch) =>
        operation === "upsert" && patch["status"] === "rolled_back" ? "rollback write unavailable" : null,
    });

    await expect(deleteAccount(f.db, "u", {})).rejects.toThrow("record deletion job: rollback write unavailable");
    expect(f.calls.unban).toBe(1);
    expect(f.jobs[0]).toMatchObject({ status: "pending" });
  });

  it("surfaces a final completion job write failure", async () => {
    const f = fake({
      users: { u: { banned_until: null } },
      rpc: () => ({ data: { ok: true }, error: null }),
      jobWriteError: (operation, patch) =>
        operation === "upsert" && patch["status"] === "completed" ? "completion write unavailable" : null,
    });

    await expect(deleteAccount(f.db, "u", {})).rejects.toThrow("record deletion job: completion write unavailable");
    expect(f.jobs[0]).toMatchObject({ status: "pending" });
  });

  it("surfaces a scheduled recovery status update failure without changing a preexisting ban", async () => {
    const original = future(3600_000);
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "preexisting" }],
      users: { u: { banned_until: original } },
      jobWriteError: (operation, patch) =>
        operation === "update" && patch["sign_in_restored"] === true ? "recovery update unavailable" : null,
    });

    await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("record deletion recovery: recovery update unavailable");
    expect(f.calls.unban).toBe(0);
    expect(f.users["u"]!.banned_until).toBe(original);
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: false });
  });

  it("surfaces a stale-pending transition failure instead of reporting an idle run", async () => {
    const bannedUntil = future(BAN_MS);
    const jobs = [{ user_id: "u", status: "pending", sign_in_restored: true, ban_provenance: "deletion", deletion_ban_expires_at: bannedUntil }];
    const f = fake({
      jobs,
      users: { u: { banned_until: bannedUntil } },
      rpc: (fn) => fn === "recover_stale_account_deletion"
        ? { data: null, error: { message: "rollback transition unavailable" } }
        : { data: null, error: null },
    });

    await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("record deletion recovery: rollback transition unavailable");
    expect(f.calls.unban).toBe(0);
    expect(jobs[0]).toMatchObject({ status: "pending", sign_in_restored: true });
    expect(f.users["u"]!.banned_until).toBe(bannedUntil);
  });

  it("retries stale recovery successfully after the transition write recovers", async () => {
    const bannedUntil = future(BAN_MS);
    const jobs = [{ user_id: "u", status: "pending", sign_in_restored: true, ban_provenance: "deletion", deletion_ban_expires_at: bannedUntil }];
    let storageUnavailable = true;
    const f = fake({
      jobs,
      users: { u: { banned_until: bannedUntil } },
      rpc: (fn) => {
        if (fn !== "recover_stale_account_deletion") return { data: null, error: null };
        if (storageUnavailable) return { data: null, error: { message: "temporary storage failure" } };
        Object.assign(jobs[0]!, { status: "rolled_back", sign_in_restored: false });
        return { data: "rolled_back", error: null };
      },
    });

    await expect(recoverStalePendingDeletions(f.db)).rejects.toThrow("temporary storage failure");
    expect(f.calls.unban).toBe(0);
    storageUnavailable = false;
    await expect(recoverStalePendingDeletions(f.db)).resolves.toEqual({ recovered: 1, restored: 1 });
    expect(f.calls.unban).toBe(1);
    expect(f.calls.rpc.filter((fn) => fn === "recover_stale_account_deletion")).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: true, restoration_reason: "deletion_ban_lifted" });
    expect(f.users["u"]!.banned_until).toBeNull();
  });

  it("surfaces a scheduled completion update failure", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "data_removed", attempts: 0 }],
      users: { u: { banned_until: future(BAN_MS) } },
      rpc: () => ({ data: { ok: true }, error: null }),
      jobWriteError: (operation, patch) =>
        operation === "update" && patch["status"] === "completed" ? "retry completion unavailable" : null,
    });

    await expect(retryPendingAccountDeletions(f.db)).rejects.toThrow("record deletion retry: retry completion unavailable");
    expect(f.jobs[0]).toMatchObject({ status: "data_removed", attempts: 0 });
  });
});
