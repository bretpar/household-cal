import { sendTemplateEmail } from "@/lib/email-templates/send-email";

const SITE_URL = "https://ourfamilycalendar.com";

type AnyDb = {
  from: (table: string) => any;
  rpc: (...args: any[]) => any;
};

async function invitationEmailAllowed(
  admin: AnyDb,
  invitedBy: string | null,
  familyId: string,
  recipient: string,
): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const recipientHash = createHash("sha256").update(recipient.trim().toLowerCase()).digest("hex");
  const limits = [
    { bucket: `household-invitation-sender:${invitedBy ?? familyId}`, max: 20, window: 3600 },
    { bucket: `household-invitation-recipient:${recipientHash}`, max: 3, window: 86400 },
  ];
  for (const limit of limits) {
    const { data: allowed, error } = await admin.rpc("consume_auth_lookup", {
      _bucket: limit.bucket,
      _max: limit.max,
      _window_seconds: limit.window,
    });
    if (error || allowed !== true) return false;
  }
  return true;
}

/**
 * Emails a household invitation link. Never throws: the caller falls back to the
 * "Copy link" flow when delivery does not succeed.
 */
export async function sendHouseholdInvitationEmail(
  admin: AnyDb,
  invitationId: string,
): Promise<{ emailed: boolean }> {
  try {
    const { data: invite } = await admin
      .from("family_invitations")
      .select("id, email, role, token, family_id, invited_by, families(name)")
      .eq("id", invitationId)
      .maybeSingle();
    if (!invite?.token || !invite?.email) return { emailed: false };
    if (!await invitationEmailAllowed(admin, invite.invited_by as string | null, invite.family_id as string, invite.email as string)) {
      return { emailed: false };
    }

    const result = await sendTemplateEmail("household-invitation", invite.email as string, {
      idempotencyKey: `household-invitation-${invite.id}-${invite.token}`,
      templateData: {
        householdName: (invite.families as { name?: string } | null)?.name ?? "your family calendar",
        role: invite.role,
        inviteUrl: `${SITE_URL}/invite/${invite.token}`,
      },
    });
    return { emailed: result.sent };
  } catch (error) {
    console.error("household invitation email failed", error);
    return { emailed: false };
  }
}
