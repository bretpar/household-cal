import * as React from "react";

import type { TemplateEntry } from "./registry";
import { ReviewEmailShell, ShellText } from "./review-email-shell";

export interface HouseholdInvitationProps {
  householdName?: string;
  inviterName?: string;
  role?: string;
  inviteUrl?: string;
}

const ROLE_COPY: Record<string, string> = {
  owner: "Owner — manage the calendar, people and access",
  editor: "Editor — add and edit events",
  viewer: "Viewer — see the calendar",
};

export function HouseholdInvitationEmail({
  householdName = "the family calendar",
  inviterName,
  role = "viewer",
  inviteUrl = "https://ourfamilycalendar.com",
}: HouseholdInvitationProps) {
  return (
    <ReviewEmailShell
      preview={`Join ${householdName} on Our Family Calendar`}
      heading="Come join the family calendar"
      url={inviteUrl}
      actionLabel="Join calendar"
      browserLabel="Open invitation in browser"
      footerNote="You received this because someone invited you to their family calendar."
    >
      <ShellText>
        {inviterName ? `${inviterName} invited you` : "You've been invited"} to share the {householdName} calendar — school,
        activities, work trips and who's covering what, all in one place.
      </ShellText>
      <ShellText>Your access: {ROLE_COPY[role] ?? role}</ShellText>
      <ShellText muted>You'll sign in with your own account. This link expires in a few days.</ShellText>
    </ReviewEmailShell>
  );
}

export const template = {
  component: HouseholdInvitationEmail,
  displayName: "Household invitation",
  subject: (data: Record<string, any>) =>
    `You're Invited to ${data?.["householdName"] ?? "a Family Calendar"} on Our Family Calendar`,
  previewData: {
    householdName: "Parker Family",
    inviterName: "Dad",
    role: "editor",
    inviteUrl: "https://ourfamilycalendar.com/invite/example-token",
  },
} satisfies TemplateEntry;
