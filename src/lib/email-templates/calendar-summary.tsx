import * as React from "react";
import { Section, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { colors, EmailButton, EmailHeading, EmailShell, EmailText } from "./shell";

/**
 * Scheduled calendar summary (daily / weekly / monthly).
 * Content is intentionally minimal: event name, member badges, time.
 */

/** Email-safe hex equivalents of the app's member palette. */
export const EMAIL_MEMBER_COLORS: Record<string, string> = {
  sky: "#8fbfe0",
  rose: "#eba7b6",
  amber: "#e8bf7c",
  sage: "#a7c4a0",
  teal: "#8ac6c0",
  lilac: "#b9aede",
  coral: "#ef9f86",
  sand: "#d8c3a5",
};

const FALLBACK_BADGE = "#cfc5b8";

export interface SummaryEmailBadge {
  initial: string;
  color: string;
}

export interface SummaryEmailItem {
  title: string;
  time: string;
  badges: SummaryEmailBadge[];
}

export interface SummaryEmailDay {
  label: string;
  items: SummaryEmailItem[];
}

export interface CalendarSummaryProps {
  heading?: string;
  intro?: string;
  days?: SummaryEmailDay[];
  emptyMessage?: string;
  calendarUrl?: string;
  unsubscribeUrl?: string;
  subject?: string;
}

const styles = {
  dayLabel: {
    margin: "22px 0 8px",
    fontSize: "14px",
    fontWeight: "bold" as const,
    color: colors.heading,
    letterSpacing: "0.01em",
  },
  item: {
    padding: "10px 12px",
    marginBottom: "8px",
    backgroundColor: colors.pageBg,
    borderRadius: "12px",
  },
  itemTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: "bold" as const,
    color: colors.heading,
    lineHeight: "22px",
  },
  itemTime: { margin: "2px 0 0", fontSize: "13px", color: colors.muted, lineHeight: "20px" },
  badge: {
    display: "inline-block",
    width: "20px",
    height: "20px",
    lineHeight: "20px",
    borderRadius: "10px",
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "bold" as const,
    color: "#3d3229",
    marginLeft: "4px",
  },
  cta: { textAlign: "center" as const, padding: "24px 0 6px" },
  footerSmall: { fontSize: "12px", lineHeight: "20px", color: colors.muted, margin: "0 0 4px" },
  link: { color: colors.accent },
};

function Badges({ badges }: { badges: SummaryEmailBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((badge, index) => (
        <span
          key={`${badge.initial}-${index}`}
          style={{
            ...styles.badge,
            backgroundColor: EMAIL_MEMBER_COLORS[badge.color] ?? FALLBACK_BADGE,
          }}
        >
          {badge.initial}
        </span>
      ))}
    </>
  );
}

export function CalendarSummaryEmail({
  heading = "Welcome to the week.",
  intro = "Here are the activities for the week.",
  days = [],
  emptyMessage = "No activities are scheduled for this week.",
  calendarUrl = "https://ourfamilycalendar.com",
  unsubscribeUrl,
}: CalendarSummaryProps) {
  return (
    <EmailShell preview={`${heading} ${intro}`}>
      <EmailHeading>{heading}</EmailHeading>
      <EmailText>{intro}</EmailText>

      {days.length === 0 ? (
        <Text style={styles.itemTime}>{emptyMessage}</Text>
      ) : (
        days.map((day) => (
          <Section key={day.label}>
            <Text style={styles.dayLabel}>{day.label}</Text>
            {day.items.map((item, index) => (
              <Section key={`${item.title}-${index}`} style={styles.item}>
                <Text style={styles.itemTitle}>
                  {item.title} <Badges badges={item.badges} />
                </Text>
                <Text style={styles.itemTime}>{item.time}</Text>
              </Section>
            ))}
          </Section>
        ))
      )}

      <Section style={styles.cta}>
        <EmailButton href={calendarUrl}>View Family Calendar</EmailButton>
      </Section>

      <Text style={styles.footerSmall}>
        You&apos;re receiving this email because you&apos;re subscribed to calendar updates from Our
        Family Calendar.
      </Text>
      {unsubscribeUrl ? (
        <Text style={styles.footerSmall}>
          <a href={unsubscribeUrl} style={styles.link}>
            Unsubscribe
          </a>
        </Text>
      ) : null}
    </EmailShell>
  );
}

export const template: TemplateEntry = {
  component: CalendarSummaryEmail,
  displayName: "Calendar summary",
  subject: (data) => String(data["subject"] ?? "Our Family Calendar"),
  previewData: {
    subject: "Our Family Calendar · Week of Aug 31",
    heading: "Welcome to the week of August 31.",
    intro: "Here are the activities for the week.",
    days: [
      {
        label: "Monday, August 31",
        items: [
          {
            title: "Soccer Practice",
            time: "4:00 PM – 5:30 PM",
            badges: [
              { initial: "B", color: "sky" },
              { initial: "E", color: "rose" },
            ],
          },
          { title: "No School", time: "All day", badges: [{ initial: "J", color: "sage" }] },
        ],
      },
    ],
    calendarUrl: "https://ourfamilycalendar.com",
    unsubscribeUrl: "https://ourfamilycalendar.com/unsubscribe/example",
  },
};

export default CalendarSummaryEmail;
