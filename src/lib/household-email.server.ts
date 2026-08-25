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
  options: { invitationId: string; token: string; email: string; role: string; familyId: string },
): Promise<{ emailed: boolean }> {
  try {
    const { data: family } = await admin
      .from("families")
      .select("name")
      .eq("id", options.familyId)
      .maybeSingle();

    const result = await sendTemplateEmail("household-invitation", options.email, {
      idempotencyKey: `household-invitation-${options.invitationId}-${options.token}`,
      templateData: {
        householdName: family?.name ?? "your family calendar",
        role: options.role,
        inviteUrl: `${SITE_URL}/invite/${options.token}`,
      },
    });
    return { emailed: result.sent };
  } catch (error) {
    console.error("household invitation email failed", error);
    return { emailed: false };
  }
}
