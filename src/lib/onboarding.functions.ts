import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createHousehold,
  loadOnboardingStatus,
  normalizeMembers,
  saveOnboardingMembers,
  type Db,
  type OnboardingStatus,
} from "@/lib/onboarding.server";

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOnboardingStatus(supabaseAdmin as unknown as Db, context.userId);
  });

export const createHouseholdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string }) => ({ name: String(data?.name ?? "") }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await createHousehold(supabaseAdmin as unknown as Db, context.userId, data.name);
    return { ...result, user_id: context.userId };
  });

export const saveHouseholdMembersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { members: unknown; removed_member_ids?: string[] }) => {
    const removed = data?.removed_member_ids ?? [];
    if (!Array.isArray(removed) || removed.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("Invalid removed family members");
    }
    return { members: normalizeMembers(data?.members), removed_member_ids: removed };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return saveOnboardingMembers(supabaseAdmin as unknown as Db, context.userId, data.members, data.removed_member_ids);
  });

/** Completion is owner-authorized; invitations cannot be created before this succeeds. */
export const finishOnboardingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveCurrentFamily, requireOwner } = await import("@/lib/household.server");
    const current = await resolveCurrentFamily(context.supabase, context.userId);
    if (!current) throw new Error("No household found");
    await requireOwner(context.supabase, context.userId, current.familyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const savedMembers = await supabaseAdmin.from("family_members").select("id")
      .eq("family_id", current.familyId).eq("active", true).limit(1);
    if (savedMembers.error) throw savedMembers.error;
    if (!savedMembers.data.length) throw new Error("Save your family members before finishing setup");
    const existing = await supabaseAdmin.from("families").select("onboarding_finished_at").eq("id", current.familyId).single();
    if (existing.error) throw existing.error;
    if (!existing.data.onboarding_finished_at) {
      const saved = await supabaseAdmin.from("families").update({ onboarding_finished_at: new Date().toISOString() })
        .eq("id", current.familyId).is("onboarding_finished_at", null);
      if (saved.error) throw saved.error;
    }
    const [members, pending] = await Promise.all([
      supabaseAdmin.from("onboarding_member_invites").select("family_member_id").eq("family_id", current.familyId),
      supabaseAdmin.from("family_invitations").select("family_member_id").eq("family_id", current.familyId)
        .eq("status", "pending").not("family_member_id", "is", null),
    ]);
    if (members.error || pending.error) throw members.error ?? pending.error;
    return { member_ids: [...new Set([...(members.data ?? []).map((m) => m.family_member_id),
      ...(pending.data ?? []).flatMap((i) => i.family_member_id ? [i.family_member_id] : [])])] };
  });

/** One member action, one expected recipient, using the existing email sender/key. */
export const sendOnboardingInvitationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { member_id: string }) => ({ member_id: String(data.member_id ?? "") }))
  .handler(async ({ data, context }) => {
    const { resolveCurrentFamily, requireOwner } = await import("@/lib/household.server");
    const current = await resolveCurrentFamily(context.supabase, context.userId);
    if (!current) throw new Error("No household found");
    await requireOwner(context.supabase, context.userId, current.familyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await supabaseAdmin.rpc("complete_onboarding_invitation", {
      _family: current.familyId, _member: data.member_id, _actor: context.userId,
    });
    if (result.error) throw result.error;
    const invitation = result.data as { id?: string; token?: string; status: string; email?: string };
    if (invitation.status !== "pending" || !invitation.id) return { status: invitation.status, email: invitation.email, token: null };
    // Expired invitations need the existing explicit resend action in Settings.
    const pending = await supabaseAdmin.from("family_invitations").select("expires_at").eq("id", invitation.id).single();
    if (pending.error) throw pending.error;
    if (new Date(pending.data.expires_at).getTime() <= Date.now()) return { status: "expired", email: invitation.email, token: null };
    const { sendHouseholdInvitationEmail } = await import("@/lib/household-email.server");
    const delivery = await sendHouseholdInvitationEmail(supabaseAdmin, invitation.id);
    return { status: delivery.emailed ? "sent" : "manual", email: invitation.email, token: invitation.token ?? null };
  });
