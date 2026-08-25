import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import type { TemplateEntry } from "./registry";

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
    <Html>
      <Head />
      <Preview>{`You're invited to ${householdName} on Our Family Calendar`}</Preview>
      <Body style={{ backgroundColor: "#faf7f2", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <Container style={{ margin: "0 auto", padding: "32px 24px", maxWidth: "560px" }}>
          <Section
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "20px",
              padding: "32px",
              border: "1px solid #ece5da",
            }}
          >
            <Heading style={{ fontSize: "22px", margin: "0 0 12px", color: "#3d3229" }}>
              You&apos;re invited to {householdName}
            </Heading>
            <Text style={{ fontSize: "15px", lineHeight: "24px", color: "#5b5045" }}>
              {inviterName ? `${inviterName} invited you` : "You have been invited"} to share the{" "}
              {householdName} calendar — school days, activities, work trips and who is covering
              what, all in one place.
            </Text>
            <Text style={{ fontSize: "14px", lineHeight: "22px", color: "#5b5045" }}>
              Your access: {ROLE_COPY[role] ?? role}
            </Text>
            <Button
              href={inviteUrl}
              style={{
                display: "inline-block",
                backgroundColor: "#e07a5f",
                color: "#ffffff",
                fontWeight: "bold",
                fontSize: "15px",
                padding: "14px 24px",
                borderRadius: "9999px",
                textDecoration: "none",
              }}
            >
              Accept invitation
            </Button>
            <Text style={{ fontSize: "12px", lineHeight: "20px", color: "#8a7d70" }}>
              You&apos;ll create or sign into your own account — nobody sets a password for you.
              This link expires in a few days; ask for a new one if it stops working.
            </Text>
            <Hr style={{ borderColor: "#ece5da", margin: "24px 0 12px" }} />
            <Text style={{ fontSize: "12px", color: "#8a7d70", margin: 0, wordBreak: "break-all" }}>
              If the button doesn&apos;t work, paste this link into your browser: {inviteUrl}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const template = {
  component: HouseholdInvitationEmail,
  displayName: "Household invitation",
  subject: (data: Record<string, any>) =>
    `You're invited to ${data?.householdName ?? "a family calendar"} on Our Family Calendar`,
  previewData: {
    householdName: "Parker Family",
    inviterName: "Dad",
    role: "editor",
    inviteUrl: "https://ourfamilycalendar.com/invite/example-token",
  },
} satisfies TemplateEntry;
