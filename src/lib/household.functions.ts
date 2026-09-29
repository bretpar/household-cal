import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  acceptInvitationByToken,
  assertRole,
  changeMembershipRole,
  createInvitation,
  loadHouseholdAccess,
  previewInvitation,
  refreshInvitation,
  removeMembership,
  setInvitationStatus,
  type AdminDb,
  type Db,
  type HouseholdAccessData,
  type InvitationPreview,
} from "@/lib/household.server";

export const getHouseholdAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HouseholdAccessData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadHouseholdAccess(
      context.supabase as unknown as Db,
      supabaseAdmin as unknown as AdminDb,
      context.userId,
    );
  });

export const inviteHouseholdUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    email: string;
    role: string;
    babysitter?: { family_member_id?: string | null; date_scope?: string; calendar_ids?: string[] } | null;
  }) => {
    const b = data.babysitter;
    if (b && !b.family_member_id) throw new Error("Choose which family member this babysitter is");
    return {
      email: String(data.email ?? ""),
      role: b ? ("viewer" as const) : assertRole(data.role),
      babysitter: b
        ? {
            family_member_id: String(b.family_member_id),
            date_scope: b.date_scope === "all_permitted" ? ("all_permitted" as const) : ("shift_days_only" as const),
            calendar_ids: Array.isArray(b.calendar_ids) ? b.calendar_ids.map(String) : [],
          }
        : null,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const invitation = await createInvitation(
      context.supabase as unknown as Db,
      supabaseAdmin as unknown as AdminDb,
      context.userId,
      data.email,
      data.role,
      data.babysitter,
    );
    const { sendHouseholdInvitationEmail } = await import("@/lib/household-email.server");
    const { emailed } = await sendHouseholdInvitationEmail(supabaseAdmin, invitation.id);
    return { ...invitation, emailed };
  });

export const revokeHouseholdInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { invitation_id: string }) => data)
  .handler(async ({ data, context }) => {
    await setInvitationStatus(
      context.supabase as unknown as Db,
      context.userId,
      data.invitation_id,
      "revoked",
    );
    return { ok: true };
  });

export const resendHouseholdInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { invitation_id: string }) => data)
  .handler(async ({ data, context }) => {
    const refreshed = await refreshInvitation(
      context.supabase as unknown as Db,
      context.userId,
      data.invitation_id,
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendHouseholdInvitationEmail } = await import("@/lib/household-email.server");
    const { emailed } = await sendHouseholdInvitationEmail(supabaseAdmin, data.invitation_id);
    return { ...refreshed, emailed };
  });

export const setHouseholdRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { membership_id: string; role: string }) => ({
    membership_id: data.membership_id,
    role: assertRole(data.role),
  }))
  .handler(async ({ data, context }) => {
    await changeMembershipRole(
      context.supabase as unknown as Db,
      context.userId,
      data.membership_id,
      data.role,
    );
    return { ok: true };
  });

export const removeHouseholdUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { membership_id: string }) => data)
  .handler(async ({ data, context }) => {
    await removeMembership(
      context.supabase as unknown as Db,
      context.userId,
      data.membership_id,
    );
    return { ok: true };
  });

export const getInvitationPreview = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: String(data.token ?? "") }))
  .handler(async ({ data }): Promise<InvitationPreview | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return previewInvitation(supabaseAdmin as unknown as AdminDb, data.token);
  });

export const acceptHouseholdInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { token: string }) => ({ token: String(data.token ?? "") }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = (context.claims as { email?: string }).email ?? null;
    return acceptInvitationByToken(
      supabaseAdmin as unknown as AdminDb,
      data.token,
      context.userId,
      email,
    );
  });

type RlsDb = { from: (table: string) => any };

export interface BabysitterSetup {
  calendars: { id: string; name: string }[];
  family_members: { id: string; name: string }[];
  profiles: { family_user_id: string; date_scope: "all_permitted" | "shift_days_only"; calendar_ids: string[] }[];
}

/** Owner-only: everything needed to configure babysitter access (RLS enforces owner). */
export const getBabysitterSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BabysitterSetup> => {
    const db = context.supabase as unknown as RlsDb;
    const { resolveCurrentFamily, requireOwner } = await import("@/lib/household.server");
    const current = await resolveCurrentFamily(db as Db, context.userId);
    if (!current) return { calendars: [], family_members: [], profiles: [] };
    await requireOwner(db as Db, context.userId, current.familyId);
    const [cals, members, profiles, links] = await Promise.all([
      db.from("calendar_sources").select("id, name, calendar_kind, active").eq("family_id", current.familyId).order("sort_order"),
      db.from("family_members").select("id, name, active").eq("family_id", current.familyId).order("sort_order"),
      db.from("babysitter_access_profiles").select("family_user_id, date_scope").eq("family_id", current.familyId),
      db.from("babysitter_access_calendars").select("family_user_id, calendar_source_id"),
    ]);
    for (const r of [cals, members, profiles, links]) if (r.error) throw r.error;
    return {
      calendars: (cals.data ?? [])
        .filter((c: any) => c.active && c.calendar_kind !== "legacy_internal")
        .map((c: any) => ({ id: c.id, name: c.name })),
      family_members: (members.data ?? []).filter((m: any) => m.active).map((m: any) => ({ id: m.id, name: m.name })),
      profiles: (profiles.data ?? []).map((p: any) => ({
        family_user_id: p.family_user_id,
        date_scope: p.date_scope,
        calendar_ids: (links.data ?? [])
          .filter((l: any) => l.family_user_id === p.family_user_id)
          .map((l: any) => l.calendar_source_id),
      })),
    };
  });

/** Owner-only: turn babysitter access on/off for a Viewer membership and set its scope. */
export const setBabysitterAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    membership_id: string;
    enabled: boolean;
    family_member_id?: string | null;
    date_scope?: string;
    calendar_ids?: string[];
  }) => ({
    membership_id: String(d.membership_id),
    enabled: Boolean(d.enabled),
    family_member_id: d.family_member_id ? String(d.family_member_id) : null,
    date_scope: d.date_scope === "all_permitted" ? ("all_permitted" as const) : ("shift_days_only" as const),
    calendar_ids: Array.isArray(d.calendar_ids) ? d.calendar_ids.map(String) : [],
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as RlsDb;
    const { requireOwner } = await import("@/lib/household.server");
    const { data: fu, error } = await db
      .from("family_users")
      .select("id, family_id, role, family_member_id")
      .eq("id", data.membership_id)
      .maybeSingle();
    if (error) throw error;
    if (!fu) throw new Error("Household user not found");
    await requireOwner(db as Db, context.userId, fu.family_id);

    if (!data.enabled) {
      const del = await db.from("babysitter_access_profiles").delete().eq("family_user_id", fu.id);
      if (del.error) throw del.error;
      return { ok: true };
    }
    if (fu.role !== "viewer") throw new Error("Only viewers can be babysitters");
    const memberId = data.family_member_id ?? fu.family_member_id;
    if (!memberId) throw new Error("Choose which family member this babysitter is");
    if (memberId !== fu.family_member_id) {
      const { data: m } = await db.from("family_members").select("id").eq("id", memberId).eq("family_id", fu.family_id).maybeSingle();
      if (!m) throw new Error("That family member isn't in this household");
      const upd = await db.from("family_users").update({ family_member_id: memberId }).eq("id", fu.id);
      if (upd.error) throw upd.error;
    }
    const up = await db
      .from("babysitter_access_profiles")
      .upsert({ family_user_id: fu.id, family_id: fu.family_id, date_scope: data.date_scope }, { onConflict: "family_user_id" });
    if (up.error) throw up.error;
    const clear = await db.from("babysitter_access_calendars").delete().eq("family_user_id", fu.id);
    if (clear.error) throw clear.error;
    if (data.calendar_ids.length > 0) {
      const ins = await db
        .from("babysitter_access_calendars")
        .insert(data.calendar_ids.map((id) => ({ family_user_id: fu.id, calendar_source_id: id })));
      if (ins.error) throw ins.error;
    }
    return { ok: true };
  });
