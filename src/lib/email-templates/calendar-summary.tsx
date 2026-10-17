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

import {
  brandColors,
  EMAIL_CATEGORY_TINTS,
  EMAIL_FALLBACK_BADGE,
  EMAIL_FALLBACK_TINT,
  EMAIL_MEMBER_COLORS,
  EMAIL_MEMBER_INK,
} from "./brand-colors";

export { EMAIL_MEMBER_COLORS };

const brand = {
  navy: brandColors.navy,
  navySoft: brandColors.blue,
  coral: brandColors.coral,
  ink: brandColors.ink,
  body: brandColors.body,
  muted: brandColors.muted,
  white: brandColors.white,
  page: "#FAF8F3",
  heroTint: brandColors.blueSoft,
  border: brandColors.border,
  neutralAccent: brandColors.borderSoft,
};

const FALLBACK_BADGE = EMAIL_FALLBACK_BADGE;
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
    borderRadius: "20px",
    border: `1px solid ${brand.border}`,
    overflow: "hidden" as const,
  },
  header: { backgroundColor: brand.white, padding: "18px 20px", borderBottom: `1px solid ${brand.border}` },
  headerBrand: {
    margin: 0,
    fontSize: "17px",
    lineHeight: "24px",
    fontWeight: "bold" as const,
    color: brand.navy,
    letterSpacing: "0.01em",
  },
  headerMark: {
    display: "inline-block",
    width: "28px",
    height: "28px",
    lineHeight: "28px",
    textAlign: "center" as const,
    borderRadius: "9px",
    backgroundColor: brand.heroTint,
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
  content: { padding: "4px 16px 4px" },
  dayLabel: {
    margin: 0,
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: "bold" as const,
    color: brand.navy,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  dayCount: {
    margin: 0,
    fontSize: "12px",
    lineHeight: "18px",
    color: brand.muted,
    textAlign: "right" as const,
  },
  dayDivider: { borderTop: `1px solid ${brand.border}`, fontSize: 0, lineHeight: 0 },
  itemTitle: {
    margin: 0,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "bold" as const,
    color: brand.ink,
  },
  itemTime: { margin: "1px 0 0", fontSize: "12px", lineHeight: "17px", color: brand.muted },
  babysitterLabel: { margin: "1px 0 0", fontSize: "11px", lineHeight: "15px", color: brand.navySoft },
  badge: {
    display: "inline-block",
    width: "22px",
    height: "22px",
    lineHeight: "22px",
    borderRadius: "11px",
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "bold" as const,
    color: brandColors.ink,
    marginLeft: "4px",
  },
  categoryIcon: {
    display: "inline-block",
    width: "24px",
    height: "24px",
    lineHeight: "24px",
    textAlign: "center" as const,
    borderRadius: "8px",
    fontSize: "13px",
  },
  cta: {
    display: "block",
    backgroundColor: "#8FC4E7",
    color: brand.navy,
    border: `1px solid ${brand.navySoft}`,
    fontWeight: "bold" as const,
    fontSize: "16px",
    lineHeight: "22px",
    padding: "15px 20px",
    borderRadius: "10px",
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
            color: EMAIL_MEMBER_INK[badge.color] ?? brandColors.ink,
          }}
        >
          {badge.initial}
        </span>
      ))}
    </>
  );
}

/** Caregiver shift rows get a subtle pastel blue background. */
function isBabysitterShift(item: SummaryEmailItem): boolean {
  return /babysit|childcare|caregiver/i.test(item.categoryName ?? "");
}

function ActivityRow({ item }: { item: SummaryEmailItem }) {
  const key = item.categoryColor ?? "";
  const accent = EMAIL_MEMBER_COLORS[key] ?? brand.neutralAccent;
  const tint = EMAIL_CATEGORY_TINTS[key] ?? EMAIL_FALLBACK_TINT;
  const icon = categoryIcon(item.categoryName);
  const babysitter = isBabysitterShift(item);
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={{
        width: "100%",
        marginBottom: "6px",
        backgroundColor: babysitter ? brand.heroTint : brand.white,
        borderRadius: "10px",
      }}
    >
      <tbody>
        <tr>
          <td width="3" style={{ width: "3px", backgroundColor: accent, borderRadius: "3px 0 0 3px", fontSize: 0 }}>
            &nbsp;
          </td>
          {icon ? (
            <td valign="middle" style={{ padding: "8px 0 8px 8px", width: "32px" }}>
              <span style={{ ...styles.categoryIcon, backgroundColor: tint }}>{icon}</span>
            </td>
          ) : null}
          <td valign="middle" style={{ padding: "8px 10px", wordBreak: "break-word" as const }}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {babysitter ? <Text style={styles.babysitterLabel}>Babysitter</Text> : null}
            <Text style={styles.itemTime}>{item.time}</Text>
          </td>
          {item.badges && item.badges.length > 0 ? (
            <td valign="middle" align="right" style={{ padding: "8px 10px 8px 0", whiteSpace: "nowrap" as const }}>
              <Badges badges={item.badges} />
            </td>
          ) : null}
        </tr>
      </tbody>
    </table>
  );
}

function DayHeader({ label, count }: { label: string; count: number }) {
  return (
    <Section style={{ padding: "14px 0 6px" }}>
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
        <tbody>
          <tr>
            <td valign="middle">
              <Text style={styles.dayLabel}>{label}</Text>
            </td>
            <td valign="middle" align="right">
              <Text style={styles.dayCount}>
                {count} {count === 1 ? "activity" : "activities"}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ ...styles.dayDivider, marginTop: "6px" }}>&nbsp;</div>
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
                  View calendar
                </a>
              </Section>
            </Section>

            <Section style={styles.footer}>
              <Text style={styles.footerText}>
                <span style={{ color: brand.coral }}>♥</span> One shared calendar for the whole family, from{" "}
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
