import { describe, expect, it, vi } from "vitest";

import { resolveMembership } from "@/lib/calendar-ops";
import { acceptInvitationByToken, type AdminDb } from "@/lib/household.server";

const TOKEN = "valid-invitation-token";
const USER_ID = "11111111-1111-1111-1111-111111111111";

type Invite = {
  id: string;
  family_id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
};

function invitationFixture(overrides: Partial<Invite> = {}) {
  const invite: Invite = {
    id: "22222222-2222-2222-2222-222222222222",
    family_id: "33333333-3333-3333-3333-333333333333",
    email: "caregiver@example.com",
    role: "viewer",
    status: "pending",
    expires_at: "2999-01-01T00:00:00.000Z",
    ...overrides,
  };
  const rpc = vi.fn(async () => ({
    data: { family_id: invite.family_id, role: invite.role },
    error: null,
  }));
  const expire = vi.fn(async () => ({ error: null }));
  const upsertProfile = vi.fn(async () => ({ error: null }));
  let lookedUpToken: string | null = null;
  const admin = {
    from(table: string) {
      if (table === "profiles") return { upsert: upsertProfile };
      if (table !== "family_invitations") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: (column: string, value: string) => ({
            limit: async () => {
              expect(column).toBe("token");
              lookedUpToken = value;
              return { data: value === TOKEN ? [invite] : [] };
            },
          }),
        }),
        update: (value: { status: string }) => ({
          eq: async (_column: string, id: string) => {
            expect(value).toEqual({ status: "expired" });
            expect(id).toBe(invite.id);
            return expire();
          },
        }),
      };
    },
    rpc,
  };
  return {
    admin: admin as unknown as AdminDb,
    invite,
    rpc,
    expire,
    upsertProfile,
    tokenUsed: () => lookedUpToken,
  };
}

describe("explicit household invitation acceptance", () => {
  it("rejects an invalid invitation token before granting membership", async () => {
    const f = invitationFixture();
    await expect(acceptInvitationByToken(f.admin, "wrong-token", USER_ID, "caregiver@example.com")).rejects.toThrow(
      "This invitation link is not valid",
    );
    expect(f.tokenUsed()).toBe("wrong-token");
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("uses the supplied valid token and returns the invitation's assigned role", async () => {
    const f = invitationFixture({ role: "viewer" });
    await expect(acceptInvitationByToken(f.admin, TOKEN, USER_ID, "Caregiver@example.com")).resolves.toEqual({
      family_id: f.invite.family_id,
      role: "viewer",
    });
    expect(f.tokenUsed()).toBe(TOKEN);
    expect(f.rpc).toHaveBeenCalledWith("accept_household_invitation", {
      _invitation_id: f.invite.id,
      _user_id: USER_ID,
    });
    expect(f.upsertProfile).toHaveBeenCalledWith({ id: USER_ID }, { onConflict: "id" });
  });

  it("rejects a signed-in recipient whose email does not match", async () => {
    const f = invitationFixture();
    await expect(acceptInvitationByToken(f.admin, TOKEN, USER_ID, "other@example.com")).rejects.toThrow(
      "This invitation was sent to caregiver@example.com",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("rejects and expires an expired pending invitation", async () => {
    const f = invitationFixture({ expires_at: "2000-01-01T00:00:00.000Z" });
    await expect(acceptInvitationByToken(f.admin, TOKEN, USER_ID, "caregiver@example.com")).rejects.toThrow(
      "This invitation has expired",
    );
    expect(f.expire).toHaveBeenCalledOnce();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("rejects a revoked invitation before granting membership", async () => {
    const f = invitationFixture({ status: "revoked" });
    await expect(acceptInvitationByToken(f.admin, TOKEN, USER_ID, "caregiver@example.com")).rejects.toThrow(
      "This invitation was revoked",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("keeps repeat acceptance idempotent through the existing atomic operation", async () => {
    const f = invitationFixture({ status: "accepted", role: "editor" });
    await expect(acceptInvitationByToken(f.admin, TOKEN, USER_ID, "caregiver@example.com")).resolves.toEqual({
      family_id: f.invite.family_id,
      role: "editor",
    });
    expect(f.rpc).toHaveBeenCalledOnce();
  });
});

describe("membership resolution without email-based claims", () => {
  function membershipDb(rows: { family_id: string }[]) {
    const tables: string[] = [];
    return {
      tables,
      db: {
        from(table: string) {
          tables.push(table);
          if (table === "profiles") return { upsert: async () => ({ error: null }) };
          if (table === "family_users") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({ limit: async () => ({ data: rows }) }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      },
    };
  }

  it("preserves an existing household membership", async () => {
    const f = membershipDb([{ family_id: "existing-family" }]);
    await expect(resolveMembership(f.db, USER_ID)).resolves.toBe("existing-family");
    expect(f.tables).toEqual(["profiles", "family_users"]);
  });

  it("does not query or claim pending invitations by email when no membership exists", async () => {
    const f = membershipDb([]);
    await expect(resolveMembership(f.db, USER_ID)).resolves.toBeNull();
    expect(f.tables).toEqual(["profiles", "family_users"]);
    expect(f.tables).not.toContain("family_invitations");
  });
});
