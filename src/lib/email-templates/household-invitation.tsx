import * as React from "react";

import type { TemplateEntry } from "./registry";
import {
  EmailButton,
  EmailHeading,
  EmailLinkFallback,
  EmailShell,
  EmailSmallText,
  EmailText,
} from "./shell";

export interface HouseholdInvitationProps {
  householdName?: string;
  inviterName?: string;
  role?: string;
  inviteUrl?: string;
}

const ROLE_COPY: Record<string, string> = {
  owner: "Owner — can manage the calendar, people and access",
  editor: "Editor — can add and edit events",
  viewer: "Viewer — can see the calendar, view only",
};

export function HouseholdInvitationEmail({
  householdName = "the family calendar",
  inviterName,
  role = "viewer",
  inviteUrl = "https://ourfamilycalendar.com",
}: HouseholdInvitationProps) {
  return (
    <EmailShell
      preview={`You're invited to ${householdName} on Our Family Calendar`}
      footerNote="You received this email because someone invited you to their family calendar."
    >
      <EmailHeading>You&apos;re invited to {householdName}</EmailHeading>
      <EmailText>
        {inviterName ? `${inviterName} invited you` : "You have been invited"} to share the{" "}
        {householdName} calendar — school days, activities, work trips and who is covering what, all
        in one place.
      </EmailText>
      <EmailText>Your access: {ROLE_COPY[role] ?? role}</EmailText>
      <EmailButton href={inviteUrl}>Join Family Calendar</EmailButton>
      <EmailSmallText>
        You&apos;ll create or sign into your own account — nobody sets a password for you. This link
        expires in a few days; ask for a new one if it stops working.
      </EmailSmallText>
      <EmailLinkFallback url={inviteUrl} />
    </EmailShell>
  );
}

export const template = {
  component: HouseholdInvitationEmail,
  displayName: "Household invitation",
  subject: (data: Record<string, any>) =>
    `You're invited to ${data?.['householdName'] ?? "a family calendar"} on Our Family Calendar`,
  previewData: {
    householdName: "Parker Family",
    inviterName: "Dad",
    role: "editor",
    inviteUrl: "https://ourfamilycalendar.com/invite/example-token",
  },
} satisfies TemplateEntry;
