import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import logoAsset from "@/assets/logo.png.asset.json";
import { brandColors } from "./brand-colors";
import { BRAND_NAME, BRAND_URL } from "./shell";

const palette = { ...brandColors, page: "#FAF8F3", button: "#b9d8ea" };
const styles = {
  body: { margin: 0, padding: 0, backgroundColor: palette.white, fontFamily: "Arial, Helvetica, sans-serif" },
  page: { backgroundColor: palette.page, padding: "32px 12px" },
  container: { maxWidth: "520px", margin: "0 auto", width: "100%" },
  brand: { margin: "12px 0 24px", color: palette.navy, fontSize: "16px", fontWeight: "bold" as const, textAlign: "center" as const },
  card: { backgroundColor: palette.white, border: `1px solid ${palette.borderSoft}`, borderRadius: "20px", padding: "32px 24px", textAlign: "center" as const },
  heading: { margin: "24px 0 14px", color: palette.navy, fontSize: "25px", lineHeight: "32px" },
  message: { margin: "0 0 26px", color: palette.body, fontSize: "16px", lineHeight: "26px" },
  button: { backgroundColor: palette.button, color: palette.navy, border: `1px solid ${palette.navySoft}`, borderRadius: "10px", padding: "14px 24px", fontSize: "16px", lineHeight: "22px", fontWeight: "bold" as const, textDecoration: "none" },
  footer: { padding: "0 8px", textAlign: "center" as const },
  small: { margin: "6px 0", color: palette.muted, fontSize: "12px", lineHeight: "20px" },
  link: { color: palette.navy, textDecoration: "underline" },
};

interface ReviewEmailShellProps {
  preview: string;
  heading: string;
  children: React.ReactNode;
  url?: string;
  actionLabel: string;
  browserLabel: string;
}

/** Opt-in review layout using email-safe tables and inline styles. */
export function ReviewEmailShell({ preview, heading, children, url, actionLabel, browserLabel }: ReviewEmailShellProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Section style={styles.page}>
          <Container style={styles.container}>
            <Img src={new URL(logoAsset.url, BRAND_URL).href} width="64" height="64" alt="" style={{ margin: "0 auto", display: "block", borderRadius: "12px" }} />
            <Text style={styles.brand}>{BRAND_NAME}</Text>
            <Section style={styles.card}>
              {/* HTML document/check motif: no unsupported SVG or new image dependency. */}
              <Section aria-hidden="true" style={{ width: "58px", margin: "0 auto", padding: "12px 10px", border: `2px solid ${palette.navySoft}`, borderRadius: "8px", backgroundColor: palette.blueSoft }}>
                <Hr style={{ borderColor: palette.button, margin: "0 0 7px" }} />
                <Hr style={{ borderColor: palette.button, margin: "0 0 7px" }} />
                <Text style={{ margin: 0, fontSize: "24px", lineHeight: "26px", color: palette.blue, fontWeight: "bold" }}>✓</Text>
              </Section>
              <Heading style={styles.heading}>{heading}</Heading>
              <Text style={styles.message}>{children}</Text>
              {url ? <Button href={url} style={styles.button}>{actionLabel}</Button> : null}
            </Section>
            <Hr style={{ borderColor: palette.border, margin: "24px 0 18px" }} />
            <Section style={styles.footer}>
              <Text style={{ ...styles.small, color: palette.navy, fontWeight: "bold" }}><span style={{ color: palette.coral }}>♥</span> {BRAND_NAME}</Text>
              <Text style={styles.small}>One shared calendar for the whole family.</Text>
              <Text style={{ ...styles.small, marginTop: "12px" }}>
                {url ? <><Link href={url} style={styles.link}>{browserLabel}</Link>{" · "}</> : null}
                <Link href="mailto:info@ourfamilycalendar.com" style={styles.link}>Help</Link>
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}