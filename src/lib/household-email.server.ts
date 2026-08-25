import { sendTemplateEmail } from "@/lib/email-templates/send-email";

const SITE_URL = "https://ourfamilycalendar.com";

type AnyDb = {
  from: (table: string) => any;
};

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
      .select("id, email, role, token, family_id, families(name)")
      .eq("id", invitationId)
      .maybeSingle();
    if (!invite?.token || !invite?.email) return { emailed: false };

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
