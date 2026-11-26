import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migration contract tests only; Codex verifies live acceptance and removal flows.
const sql = readFileSync(new URL("../drizzle/migrations/0067_bind_accepted_invitation_membership.sql", import.meta.url), "utf8");
const reactivationSql = readFileSync(new URL("../drizzle/migrations/0068_prevent_accepted_invitation_reactivation.sql", import.meta.url), "utf8");
const acceptedBranch = sql.slice(sql.indexOf(" IF inv.status='accepted' THEN"), sql.indexOf(" IF fu_id IS NULL THEN"));

describe("accepted invitation database safeguards", () => {
  it("blocks older clients from reopening accepted invitations and rejects previously reopened links", () => {
    expect(reactivationSql).toContain("OLD.status='accepted' OR OLD.accepted_by IS NOT NULL OR OLD.accepted_at IS NOT NULL OR OLD.accepted_membership_id IS NOT NULL");
    expect(reactivationSql).toContain("BEFORE UPDATE OF status ON public.family_invitations");
    expect(reactivationSql).toContain("inv.accepted_by IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.accepted_membership_id IS NOT NULL");
  });
  it("rejects missing or replacement memberships before any membership insert", () => {
    expect(acceptedBranch).toContain("fu_id IS NULL OR inv.accepted_membership_id IS DISTINCT FROM fu_id THEN RAISE EXCEPTION");
    expect(sql.indexOf(acceptedBranch)).toBeLessThan(sql.indexOf("INSERT INTO public.family_users"));
    expect(acceptedBranch).not.toContain("INSERT");
  });

  it("returns the current role without recreating an intact accepted membership", () => {
    expect(acceptedBranch).toContain("RETURN jsonb_build_object('family_id',inv.family_id,'role',actual_role)");
    expect(sql).toContain("user_id=_user_id FOR SHARE");
  });

  it("binds pending acceptance to its membership and backfills only provably older memberships", () => {
    expect(sql).toContain("accepted_by=_user_id,accepted_membership_id=fu_id");
    expect(sql).toContain("i.accepted_at IS NOT NULL AND f.created_at<=i.accepted_at");
    expect(sql).toContain("inv.status='pending' AND inv.expires_at<=now()");
  });

  it("keeps direct invitation acceptance unavailable to public and signed-in roles", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.accept_household_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.accept_household_invitation(uuid,uuid) TO service_role;");
  });
});