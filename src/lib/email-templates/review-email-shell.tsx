import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import logoAsset from "@/assets/logo.png.asset.json";
import { brandColors } from "./brand-colors";
import { BRAND_NAME, BRAND_URL } from "./shell";

export const reviewPalette = { ...brandColors, page: "#FAF8F3", button: "#8FC4E7" };
const palette = reviewPalette;
const styles = {
  body: { margin: 0, padding: 0, backgroundColor: palette.white, fontFamily: "Arial, Helvetica, sans-serif" },
  page: { backgroundColor: palette.page, padding: "32px 12px" },
  container: { maxWidth: "520px", margin: "0 auto", width: "100%" },
  brand: { margin: "12px 0 24px", color: palette.navy, fontSize: "16px", fontWeight: "bold" as const, textAlign: "center" as const },
  card: { backgroundColor: palette.white, border: `1px solid ${palette.borderSoft}`, borderRadius: "20px", padding: "32px 24px" },
  heading: { margin: "0 0 14px", color: palette.navy, fontSize: "24px", lineHeight: "32px" },
  message: { margin: "0 0 22px", color: palette.body, fontSize: "16px", lineHeight: "26px" },
  button: { backgroundColor: palette.button, color: palette.navy, border: `1px solid ${palette.navySoft}`, borderRadius: "10px", padding: "14px 24px", fontSize: "16px", lineHeight: "22px", fontWeight: "bold" as const, textDecoration: "none" },
  footer: { padding: "0 8px", textAlign: "center" as const },
  small: { margin: "6px 0", color: palette.muted, fontSize: "12px", lineHeight: "20px" },
  link: { color: palette.navy, textDecoration: "underline" },
};

/** Paragraph inside the shared shell. */
export function ShellText({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Text style={{ ...styles.message, margin: "0 0 14px", ...(muted ? { color: palette.muted, fontSize: "14px", lineHeight: "22px" } : {}) }}>
      {children}
    </Text>
  );
}

interface ReviewEmailShellProps {
  preview: string;
  heading: string;
  children: React.ReactNode;
  url?: string | undefined;
  actionLabel?: string;
  browserLabel?: string;
  /** Why the recipient got this email (footer). */
  footerNote?: string;
  /** Document/check motif above the heading. */
  showMotif?: boolean;
  align?: "center" | "left";
}

/** Shared app-email layout using email-safe tables and inline styles. */
export function ReviewEmailShell({ preview, heading, children, url, actionLabel, browserLabel, footerNote, showMotif, align = "center" }: ReviewEmailShellProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Section style={styles.page}>
          <Container style={styles.container}>
            <Img src={new URL(logoAsset.url, BRAND_URL).href} width="64" height="64" alt="" style={{ margin: "0 auto", display: "block", borderRadius: "12px" }} />
            <Text style={styles.brand}>{BRAND_NAME}</Text>
            <Section style={{ ...styles.card, textAlign: align }}>
              {showMotif ? (
                <Section aria-hidden="true" style={{ width: "58px", margin: "0 auto 24px", padding: "12px 10px", border: `2px solid ${palette.navySoft}`, borderRadius: "8px", backgroundColor: palette.blueSoft, textAlign: "center" }}>
                  <Hr style={{ borderColor: palette.button, margin: "0 0 7px" }} />
                  <Hr style={{ borderColor: palette.button, margin: "0 0 7px" }} />
                  <Text style={{ margin: 0, fontSize: "24px", lineHeight: "26px", color: palette.blue, fontWeight: "bold" }}>✓</Text>
                </Section>
              ) : null}
              <Heading style={styles.heading}>{heading}</Heading>
              {typeof children === "string" ? <Text style={styles.message}>{children}</Text> : <Section>{children}</Section>}
              {url && actionLabel ? (
                <Section style={{ textAlign: "center", paddingTop: "8px" }}>
                  <Button href={url} style={styles.button}>{actionLabel}</Button>
                </Section>
              ) : null}
            </Section>
            <Hr style={{ borderColor: palette.border, margin: "24px 0 18px" }} />
            <Section style={styles.footer}>
              <Text style={{ ...styles.small, color: palette.navy, fontWeight: "bold" }}><span style={{ color: palette.coral }}>♥</span> {BRAND_NAME}</Text>
              <Text style={styles.small}>One shared calendar for the whole family.</Text>
              {footerNote ? <Text style={styles.small}>{footerNote}</Text> : null}
              <Text style={{ ...styles.small, marginTop: "12px" }}>
                {url && browserLabel ? <><Link href={url} style={styles.link}>{browserLabel}</Link>{" · "}</> : null}
                <Link href="mailto:info@ourfamilycalendar.com" style={styles.link}>Help</Link>
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
