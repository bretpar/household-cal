import * as React from "react";
import { Body, Container, Head, Html, Link, Preview, Section, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { BRAND_NAME, BRAND_URL } from "./shell";

/**
 * Scheduled calendar summary (daily / weekly / monthly).
 *
 * Visual only: content stays intentionally minimal — event name, member
 * badges, time. Layout is table/inline-style based so Gmail and Apple Mail on
 * phones render it identically (no flexbox, media queries or web fonts).
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

/** Very light tints of the same palette, for category accents. */
const EMAIL_CATEGORY_TINTS: Record<string, string> = {
  sky: "#eef5fb",
  rose: "#fdf1f4",
  amber: "#fdf5e8",
  sage: "#f1f6ef",
  teal: "#edf7f6",
  lilac: "#f4f1fb",
  coral: "#fdf1ec",
  sand: "#f8f4ed",
};

const brand = {
  navy: "#1f3557",
  navySoft: "#3a5478",
  coral: "#e07a5f",
  ink: "#22304a",
  body: "#4d5b72",
  muted: "#7d8a9e",
  white: "#ffffff",
  page: "#eef2f8",
  heroTint: "#eff5fd",
  border: "#e4eaf3",
  neutralAccent: "#cdd6e3",
};

const FALLBACK_BADGE = "#cfc5b8";
const fontStack = "Arial, Helvetica, sans-serif";

export interface SummaryEmailBadge {
  initial: string;
  color: string;
}

export interface SummaryEmailItem {
  title: string;
  time: string;
  badges: SummaryEmailBadge[];
  /** palette name of the event's category colour; omitted = Uncategorized */
  categoryColor?: string | null;
  categoryName?: string | null;
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
  main: { backgroundColor: brand.page, fontFamily: fontStack, margin: 0, padding: 0 },
  container: { margin: "0 auto", padding: "16px 8px 28px", maxWidth: "600px", width: "100%" },
  shell: {
    backgroundColor: brand.white,
    borderRadius: "18px",
    border: `1px solid ${brand.border}`,
    overflow: "hidden" as const,
  },
  header: { backgroundColor: brand.navy, padding: "18px 20px" },
  headerBrand: {
    margin: 0,
    fontSize: "17px",
    lineHeight: "24px",
    fontWeight: "bold" as const,
    color: brand.white,
    letterSpacing: "0.01em",
  },
  headerMark: {
    display: "inline-block",
    width: "28px",
    height: "28px",
    lineHeight: "28px",
    textAlign: "center" as const,
    borderRadius: "9px",
    backgroundColor: brand.coral,
    fontSize: "15px",
  },
  hero: {
    backgroundColor: brand.heroTint,
    padding: "18px 20px",
    borderBottom: `1px solid ${brand.border}`,
  },
  heroHeading: {
    margin: 0,
    fontSize: "19px",
    lineHeight: "26px",
    fontWeight: "bold" as const,
    color: brand.navy,
  },
  heroText: { margin: "5px 0 0", fontSize: "14px", lineHeight: "21px", color: brand.navySoft },
  content: { padding: "6px 16px 4px" },
  dayLabel: {
    margin: 0,
    fontSize: "15px",
    lineHeight: "22px",
    fontWeight: "bold" as const,
    color: brand.navy,
  },
  dayRule: { height: "3px", backgroundColor: brand.coral, borderRadius: "2px", fontSize: 0 },
  dayIcon: { fontSize: "14px", paddingRight: "6px" },
  itemTitle: {
    margin: 0,
    fontSize: "15px",
    lineHeight: "23px",
    fontWeight: "bold" as const,
    color: brand.ink,
  },
  itemTime: { margin: "3px 0 0", fontSize: "13px", lineHeight: "19px", color: brand.muted },
  badge: {
    display: "inline-block",
    width: "20px",
    height: "20px",
    lineHeight: "20px",
    borderRadius: "10px",
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "bold" as const,
    color: "#26313f",
    marginLeft: "5px",
  },
  categoryIcon: {
    display: "inline-block",
    width: "22px",
    height: "22px",
    lineHeight: "22px",
    textAlign: "center" as const,
    borderRadius: "7px",
    fontSize: "13px",
  },
  cta: {
    display: "block",
    backgroundColor: brand.navy,
    color: brand.white,
    fontWeight: "bold" as const,
    fontSize: "16px",
    lineHeight: "22px",
    padding: "15px 20px",
    borderRadius: "12px",
    textDecoration: "none",
    textAlign: "center" as const,
  },
  footer: { padding: "4px 20px 20px" },
  footerText: { margin: "0 0 4px", fontSize: "12px", lineHeight: "19px", color: brand.muted },
  link: { color: brand.coral },
  empty: { margin: "14px 0 4px", fontSize: "14px", lineHeight: "21px", color: brand.body },
};

/** Small friendly glyph for the household's own category names. */
function categoryIcon(name?: string | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/school|class|homework/.test(n)) return "🏫";
  if (/sport|soccer|practice|game|swim|dance|gym/.test(n)) return "⚽";
  if (/work|office/.test(n)) return "💼";
  if (/appoint|doctor|dentist|health/.test(n)) return "🩺";
  if (/family|home|birthday/.test(n)) return "🏡";
  if (/activity|club|music|art/.test(n)) return "🎨";
  return null;
}

function Badges({ badges }: { badges: SummaryEmailBadge[] }) {
  if (!badges || badges.length === 0) return null;
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

function ActivityCard({ item }: { item: SummaryEmailItem }) {
  const key = item.categoryColor ?? "";
  const accent = EMAIL_MEMBER_COLORS[key] ?? brand.neutralAccent;
  const tint = EMAIL_CATEGORY_TINTS[key] ?? "#f4f6fa";
  const icon = categoryIcon(item.categoryName);
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{
        width: "100%",
        marginBottom: "8px",
        backgroundColor: brand.white,
        border: `1px solid ${brand.border}`,
        borderRadius: "12px",
      }}
    >
      <tbody>
        <tr>
          <td width="4" style={{ width: "4px", backgroundColor: accent, fontSize: 0 }}>
            &nbsp;
          </td>
          {icon ? (
            <td valign="top" style={{ padding: "11px 0 11px 10px", width: "32px" }}>
              <span style={{ ...styles.categoryIcon, backgroundColor: tint }}>{icon}</span>
            </td>
          ) : null}
          <td valign="top" style={{ padding: "10px 12px 11px", wordBreak: "break-word" as const }}>
            <Text style={styles.itemTitle}>
              {item.title} <Badges badges={item.badges} />
            </Text>
            <Text style={styles.itemTime}>{item.time}</Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function DayHeader({ label }: { label: string }) {
  return (
    <Section style={{ padding: "18px 0 8px" }}>
      <Text style={styles.dayLabel}>
        <span style={styles.dayIcon}>📅</span>
        {label}
      </Text>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        width="72"
        style={{ marginTop: "6px" }}
      >
        <tbody>
          <tr>
            <td style={styles.dayRule}>&nbsp;</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function CalendarSummaryEmail({
  heading = "Welcome to the week.",
  intro = "Here are the activities for the week.",
  days = [],
  emptyMessage = "No activities are scheduled for this week.",
  calendarUrl = BRAND_URL,
  unsubscribeUrl,
}: CalendarSummaryProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${heading} ${intro}`}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.shell}>
            <Section style={styles.header}>
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td width="36" valign="middle" style={{ width: "36px" }}>
                      <span style={styles.headerMark}>📆</span>
                    </td>
                    <td valign="middle">
                      <Text style={styles.headerBrand}>{BRAND_NAME}</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={styles.hero}>
              <Text style={styles.heroHeading}>{heading}</Text>
              <Text style={styles.heroText}>{intro}</Text>
            </Section>

            <Section style={styles.content}>
              {days.length === 0 ? (
                <Text style={styles.empty}>{emptyMessage}</Text>
              ) : (
                days.map((day) => (
                  <Section key={day.label}>
                    <DayHeader label={day.label} />
                    {day.items.map((item, index) => (
                      <ActivityCard key={`${item.title}-${index}`} item={item} />
                    ))}
                  </Section>
                ))
              )}

              <Section style={{ padding: "22px 0 18px" }}>
                <a href={calendarUrl} style={styles.cta}>
                  View Family Calendar
                </a>
              </Section>
            </Section>

            <Section style={styles.footer}>
              <Text style={styles.footerText}>
                You&apos;re receiving this email because you&apos;re subscribed to updates from{" "}
                <Link href={BRAND_URL} style={styles.link}>
                  {BRAND_NAME}
                </Link>
                .
              </Text>
              {unsubscribeUrl ? (
                <Text style={styles.footerText}>
                  <a href={unsubscribeUrl} style={styles.link}>
                    Unsubscribe
                  </a>
                </Text>
              ) : null}
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
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
            categoryColor: "sage",
            categoryName: "Activity",
            badges: [
              { initial: "B", color: "sky" },
              { initial: "E", color: "rose" },
            ],
          },
          {
            title: "No School",
            time: "All day",
            categoryColor: "sky",
            categoryName: "School",
            badges: [{ initial: "J", color: "sage" }],
          },
        ],
      },
    ],
    calendarUrl: BRAND_URL,
    unsubscribeUrl: "https://ourfamilycalendar.com/unsubscribe/example",
  },
};

export default CalendarSummaryEmail;
