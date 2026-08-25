import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Shared branded email shell for Our Family Calendar.
 * Reuse this for any future app email (weekly summaries, babysitter
 * schedules, reminders, account notifications) instead of duplicating HTML.
 */

export const BRAND_NAME = "Our Family Calendar";
export const BRAND_URL = "https://ourfamilycalendar.com";

export const colors = {
  pageBg: "#faf7f2",
  cardBg: "#ffffff",
  border: "#ece5da",
  heading: "#3d3229",
  body: "#5b5045",
  muted: "#8a7d70",
  accent: "#e07a5f",
};

const fontStack = "Arial, Helvetica, sans-serif";

const styles = {
  main: { backgroundColor: colors.pageBg, fontFamily: fontStack, margin: 0, padding: 0 },
  container: { margin: "0 auto", padding: "24px 12px", maxWidth: "560px", width: "100%" },
  brandRow: { padding: "0 8px 14px" },
  brand: {
    margin: 0,
    fontSize: "16px",
    fontWeight: "bold" as const,
    color: colors.accent,
    letterSpacing: "0.02em",
  },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: "20px",
    padding: "28px 24px",
    border: `1px solid ${colors.border}`,
  },
  heading: {
    fontSize: "22px",
    lineHeight: "30px",
    margin: "0 0 12px",
    color: colors.heading,
  },
  text: { fontSize: "15px", lineHeight: "24px", color: colors.body, margin: "0 0 14px" },
  small: { fontSize: "12px", lineHeight: "20px", color: colors.muted, margin: "0 0 8px" },
  button: {
    display: "inline-block",
    backgroundColor: colors.accent,
    color: "#ffffff",
    fontWeight: "bold" as const,
    fontSize: "15px",
    padding: "14px 24px",
    borderRadius: "9999px",
    textDecoration: "none",
  },
  hr: { borderColor: colors.border, margin: "24px 0 12px" },
  footerText: { fontSize: "12px", lineHeight: "20px", color: colors.muted, margin: "0 0 4px" },
  link: { color: colors.accent, wordBreak: "break-all" as const },
};

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return <Heading style={styles.heading}>{children}</Heading>;
}

export function EmailText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}

export function EmailSmallText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.small}>{children}</Text>;
}

export function EmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button href={href} style={styles.button}>
      {children}
    </Button>
  );
}

/** Secondary plain-text copy/paste fallback for the primary CTA. */
export function EmailLinkFallback({ url, label }: { url: string; label?: string }) {
  return (
    <Text style={styles.small}>
      {label ?? "If the button doesn't work, paste this link into your browser:"}{" "}
      <Link href={url} style={styles.link}>
        {url}
      </Link>
    </Text>
  );
}

export interface EmailShellProps {
  preview: string;
  children: React.ReactNode;
  /** Optional extra footer line, e.g. why the recipient got this email. */
  footerNote?: string;
}

export function EmailShell({ preview, children, footerNote }: EmailShellProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Section style={styles.brandRow}>
            <Text style={styles.brand}>{BRAND_NAME}</Text>
          </Section>
          <Section style={styles.card}>
            {children}
            <Hr style={styles.hr} />
            {footerNote ? <Text style={styles.footerText}>{footerNote}</Text> : null}
            <Text style={styles.footerText}>
              Sent by{" "}
              <Link href={BRAND_URL} style={styles.link}>
                {BRAND_NAME}
              </Link>{" "}
              — one shared calendar for the whole family.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
