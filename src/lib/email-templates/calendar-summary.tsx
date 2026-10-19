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
  EMAIL_FALLBACK_BADGE,
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
  borderSoft: brandColors.borderSoft,
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
  headerTagline: { margin: 0, fontSize: "12px", lineHeight: "16px", color: brand.muted },
  headerMark: {
    display: "inline-block",
    width: "34px",
    height: "34px",
    lineHeight: "34px",
    textAlign: "center" as const,
    borderRadius: "10px",
    backgroundColor: brand.heroTint,
    fontSize: "17px",
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
  heroText: { margin: "3px 0 0", fontSize: "14px", lineHeight: "21px", color: brand.navySoft },
  content: { padding: "14px 16px 4px" },
  dayGroup: {
    border: `1px solid ${brand.borderSoft}`,
    borderRadius: "14px",
    padding: "12px 12px 6px",
    marginBottom: "12px",
  },
  dayBadge: {
    display: "inline-block",
    width: "46px",
    borderRadius: "10px",
    backgroundColor: brand.heroTint,
    textAlign: "center" as const,
    padding: "7px 0 8px",
  },
  dayBadgeWeekday: {
    margin: 0,
    fontSize: "10px",
    lineHeight: "13px",
    fontWeight: "bold" as const,
    color: brand.navySoft,
    letterSpacing: "0.06em",
  },
  dayBadgeDay: {
    margin: 0,
    fontSize: "19px",
    lineHeight: "22px",
    fontWeight: "bold" as const,
    color: brand.navy,
  },
  dayLabel: {
    margin: 0,
    fontSize: "14px",
    lineHeight: "19px",
    fontWeight: "bold" as const,
    color: brand.navy,
  },
  dayCount: {
    margin: 0,
    fontSize: "12px",
    lineHeight: "19px",
    color: brand.muted,
    textAlign: "right" as const,
  },
  timeStart: { margin: 0, fontSize: "12px", lineHeight: "17px", fontWeight: "bold" as const, color: brand.ink },
  timeEnd: { margin: 0, fontSize: "12px", lineHeight: "17px", color: brand.muted },
  itemTitle: {
    margin: 0,
    fontSize: "14px",
    lineHeight: "19px",
    fontWeight: "bold" as const,
    color: brand.ink,
  },
  itemMeta: { margin: "1px 0 0", fontSize: "12px", lineHeight: "16px", color: brand.muted },
  badge: {
    display: "inline-block",
    width: "24px",
    height: "24px",
    lineHeight: "24px",
    borderRadius: "12px",
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "bold" as const,
    color: brandColors.ink,
    marginLeft: "4px",
  },
  divider: { borderTop: `1px solid ${brand.borderSoft}`, fontSize: 0, lineHeight: 0 },
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
  footer: { padding: "4px 20px 20px", textAlign: "center" as const },
  footerText: { margin: "0 0 4px", fontSize: "12px", lineHeight: "19px", color: brand.muted },
  link: { color: brand.coral },
  empty: { margin: "6px 0 10px", fontSize: "14px", lineHeight: "21px", color: brand.body },
};

/** "Monday, October 19" -> { weekday: "MON", day: "19" } */
function badgeParts(label: string): { weekday: string; day: string } {
  const weekday = (label.split(",")[0] ?? "").trim().slice(0, 3).toUpperCase();
  const dayMatch = /(\d{1,2})\s*$/.exec(label);
  return { weekday, day: dayMatch?.[1] ?? "" };
}

/** Caregiver shift rows are identified by their category name. */
function isBabysitterShift(item: SummaryEmailItem): boolean {
  return /babysit|childcare|caregiver/i.test(item.categoryName ?? "");
}

/** "8:30 AM – 5:30 PM" -> "9 hours"; null when not a parseable range. */
function durationLabel(time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
  if (!match) return null;
  const toMinutes = (h: string, m: string, ap: string) => {
    let hour = Number(h) % 12;
    if (ap.toUpperCase() === "PM") hour += 12;
    return hour * 60 + Number(m);
  };
  const start = toMinutes(match[1]!, match[2]!, match[3]!);
  const end = toMinutes(match[4]!, match[5]!, match[6]!);
  const diff = end - start;
  if (diff <= 0) return null;
  const hours = diff / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}

/** "8:30 AM – 5:30 PM" -> ["8:30 AM", "5:30 PM"]; "All day" -> ["All day"] */
function timeParts(time: string): [string, string | null] {
  const parts = time.split(/\s*[–-]\s*/);
  if (parts.length === 2) return [parts[0]!, parts[1]!];
  return [time, null];
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

function EventRow({ item, last }: { item: SummaryEmailItem; last: boolean }) {
  const accent = EMAIL_MEMBER_COLORS[item.categoryColor ?? ""] ?? brand.borderSoft;
  const babysitter = isBabysitterShift(item);
  const [start, end] = timeParts(item.time);
  const duration = babysitter ? durationLabel(item.time) : null;
  const meta = babysitter
    ? `Babysitter${duration ? ` · ${duration}` : ""}`
    : (item.categoryName ?? "");
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ width: "100%" }}>
      <tbody>
        <tr>
          <td valign="middle" width="52" style={{ width: "52px", padding: "9px 0", whiteSpace: "nowrap" as const }}>
            <Text style={styles.timeStart}>{start}</Text>
            {end ? <Text style={styles.timeEnd}>{end}</Text> : null}
          </td>
          <td valign="middle" width="14" style={{ width: "14px", padding: "9px 0" }}>
            <div
              style={{
                width: "3px",
                height: "32px",
                borderRadius: "2px",
                backgroundColor: accent,
                fontSize: 0,
                lineHeight: 0,
              }}
            >
              &nbsp;
            </div>
          </td>
          <td valign="middle" style={{ padding: "9px 8px 9px 0", wordBreak: "break-word" as const }}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {meta ? <Text style={styles.itemMeta}>{meta}</Text> : null}
          </td>
          {item.badges && item.badges.length > 0 ? (
            <td valign="middle" align="right" style={{ padding: "9px 0", whiteSpace: "nowrap" as const }}>
              <Badges badges={item.badges} />
            </td>
          ) : null}
        </tr>
        {!last ? (
          <tr>
            <td colSpan={4}>
              <div style={styles.divider}>&nbsp;</div>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function DayGroup({ day }: { day: SummaryEmailDay }) {
  const badge = badgeParts(day.label);
  const count = day.items.length;
  return (
    <Section style={styles.dayGroup}>
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
        <tbody>
          <tr>
            <td valign="top" width="58" style={{ width: "58px" }}>
              <span style={styles.dayBadge}>
                <Text style={styles.dayBadgeWeekday}>{badge.weekday}</Text>
                <Text style={styles.dayBadgeDay}>{badge.day}</Text>
              </span>
            </td>
            <td valign="top">
              <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
                <tbody>
                  <tr>
                    <td valign="middle">
                      <Text style={styles.dayLabel}>{day.label}</Text>
                    </td>
                    <td valign="middle" align="right">
                      <Text style={styles.dayCount}>
                        {count} {count === 1 ? "event" : "events"}
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ ...styles.divider, margin: "8px 0 0" }}>&nbsp;</div>
              {day.items.map((item, index) => (
                <EventRow key={`${item.title}-${index}`} item={item} last={index === day.items.length - 1} />
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function CalendarSummaryEmail({
  heading = "Your week at a glance",
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
                    <td width="44" valign="middle" style={{ width: "44px" }}>
                      <span style={styles.headerMark}>📆</span>
                    </td>
                    <td valign="middle">
                      <Text style={styles.headerBrand}>{BRAND_NAME}</Text>
                      <Text style={styles.headerTagline}>Family life, better organized.</Text>
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
                days.map((day) => <DayGroup key={day.label} day={day} />)
              )}

              <Section style={{ padding: "10px 0 18px" }}>
                <a href={calendarUrl} style={styles.cta}>
                  View full calendar →
                </a>
              </Section>
            </Section>

            <Section style={styles.footer}>
              <Text style={{ ...styles.footerText, fontSize: "16px", lineHeight: "20px" }}>
                <span style={{ color: brand.coral }}>♥</span>
              </Text>
              <Text style={{ ...styles.footerText, color: brand.navy, fontWeight: "bold" }}>{BRAND_NAME}</Text>
              <Text style={styles.footerText}>One shared calendar for the whole family.</Text>
              <Text style={styles.footerText}>
                <Link href={calendarUrl} style={styles.link}>
                  Open in browser
                </Link>
                {unsubscribeUrl ? (
                  <>
                    {" · "}
                    <a href={unsubscribeUrl} style={styles.link}>
                      Unsubscribe
                    </a>
                  </>
                ) : null}
              </Text>
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
    subject: "Our Family Calendar · Week of Oct 19",
    heading: "Your week at a glance",
    intro: "October 19 – October 25, 2026",
    days: [
      {
        label: "Monday, October 19",
        items: [
          {
            title: "Michelle",
            time: "8:30 AM – 5:30 PM",
            categoryColor: "sky",
            categoryName: "Babysitter",
            badges: [{ initial: "M", color: "lilac" }],
          },
          {
            title: "Kids Place",
            time: "9:00 AM – 1:00 PM",
            categoryColor: "rose",
            categoryName: "Activity",
            badges: [{ initial: "B", color: "rose" }],
          },
        ],
      },
      {
        label: "Tuesday, October 20",
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
