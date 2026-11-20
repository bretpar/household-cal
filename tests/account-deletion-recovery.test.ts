import { describe, expect, it } from "vitest";

import {
  deleteAccount,
  listLegacyRecoveryCandidates,
  recoverStalePendingDeletions,
  restoreLegacyRolledBackSignIn,
  type DeletionDb,
} from "../src/lib/account-deletion.server";

type Row = Record<string, any>;
const BAN_MS = 876000 * 3600 * 1000;

function fake(opts: { jobs?: Row[]; users?: Record<string, { banned_until: string | null }>; rpc?: (fn: string) => any } = {}) {
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
        const ex = jobs.find((j) => j.user_id === p["user_id"]);
        if (ex) Object.assign(ex, p);
        else jobs.push({ ban_provenance: null, ...p });
        return Promise.resolve({ error: null });
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const run = () => {
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
          return { error: null };
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
    f.users["u"]!.banned_until = future(BAN_MS);
    f.jobs[0]!.deletion_ban_applied_at = new Date().toISOString();
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
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date(Date.now() - 86400_000 * 30).toISOString() }],
      users: { u: { banned_until: future(BAN_MS) } },
    });
    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(0);
    expect(f.jobs[0]!.ban_provenance).toBe("superseded");
  });

  it("G: repeated recovery is idempotent and never re-runs cleanup", async () => {
    const f = fake({
      jobs: [{ user_id: "u", status: "rolled_back", sign_in_restored: false, ban_provenance: "deletion", deletion_ban_applied_at: new Date().toISOString() }],
      users: { u: { banned_until: future(BAN_MS) } },
    });
    await recoverStalePendingDeletions(f.db);
    await recoverStalePendingDeletions(f.db);
    expect(f.calls.unban).toBe(1);
    expect(f.calls.rpc).not.toContain("delete_account_data");
    expect(f.jobs[0]).toMatchObject({ status: "rolled_back", sign_in_restored: true, ban_provenance: "deletion" });
  });
});
