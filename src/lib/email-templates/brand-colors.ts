/**
 * Email-safe mirror of the app design tokens in src/styles.css.
 *
 * Emails can't read CSS variables, so these hex values are the single source of
 * truth for every branded email. Keep them in sync with `:root` in styles.css so
 * the website and the inbox feel like the same product.
 */

export const brandColors = {
  navy: "#174e78",
  navySoft: "#e3ecf3",
  blue: "#247ba8",
  blueSoft: "#e6f1f7",
  teal: "#55c4bc",
  tealSoft: "#e4f5f3",
  coral: "#f47f72",
  coralSoft: "#fdeae7",
  rose: "#f16f7a",
  roseSoft: "#fdeaec",

  cream: "#faf8f4",
  white: "#ffffff",
  surfaceMuted: "#f3f0ea",
  border: "#e7e4de",
  borderSoft: "#efece6",

  ink: "#263a45",
  body: "#41525b",
  muted: "#6f7e84",
} as const;

/** Member badge fills — same pastels as the web member palette. */
export const EMAIL_MEMBER_COLORS: Record<string, string> = {
  sky: "#b9d8ea",
  rose: "#f0c5cf",
  amber: "#ebd7a5",
  sage: "#c9dec9",
  teal: "#b9e3de",
  lilac: "#d7cce6",
  coral: "#f6c0b8",
  sand: "#cfdbe4",
};

/** Darker related shade used for initials/text on the pastel above. */
export const EMAIL_MEMBER_INK: Record<string, string> = {
  sky: "#1c4f6d",
  rose: "#7a3145",
  amber: "#6a5015",
  sage: "#2f5436",
  teal: "#1c5450",
  lilac: "#4a3a63",
  coral: "#7d3427",
  sand: "#38505e",
};

/** Light tints used as activity/category card backgrounds. */
export const EMAIL_CATEGORY_TINTS: Record<string, string> = {
  sky: "#eaf3f9",
  rose: "#fbedf1",
  amber: "#faf3e2",
  sage: "#edf5ed",
  teal: "#e8f6f4",
  lilac: "#f2eef8",
  coral: "#fceae6",
  sand: "#edf2f6",
};

export const EMAIL_FALLBACK_BADGE = brandColors.border;
export const EMAIL_FALLBACK_TINT = brandColors.surfaceMuted;
