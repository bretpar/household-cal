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
  .inputValidator((data: { email: string; role: string }) => ({
    email: String(data.email ?? ""),
    role: assertRole(data.role),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const invitation = await createInvitation(
      context.supabase as unknown as Db,
      supabaseAdmin as unknown as AdminDb,
      context.userId,
      data.email,
      data.role,
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
