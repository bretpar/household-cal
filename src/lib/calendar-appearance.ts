/**
 * Presentation-only appearance metadata for a calendar source (connected Google
 * calendars and Apple/iCloud subscriptions).
 *
 * Nothing here ever touches the source calendar: it is purely how OFC paints
 * events that came from that calendar. Colours reuse the household palette so a
 * calendar can never introduce an off-brand colour, and the muted treatment for
 * "Background" calendars is derived automatically from the same choice — there
 * is deliberately no separate opacity setting.
 *
 * Icon *keys* live here (safe on the server, no icon library); the key -> icon
 * component map lives in `calendar-icons.ts`.
 */

import { MEMBER_COLORS, type MemberColor } from "@/lib/family-data";

export type CalendarIconKey =
  | "work"
  | "medical"
  | "school"
  | "sports"
  | "car"
  | "home"
  | "sitter"
  | "travel"
  | "birthday"
  | "family"
  | "star"
  | "calendar";

export const CALENDAR_ICON_KEYS: CalendarIconKey[] = [
  "work",
  "medical",
  "school",
  "sports",
  "car",
  "home",
  "sitter",
  "travel",
  "birthday",
  "family",
  "star",
  "calendar",
];

export const CALENDAR_ICON_LABELS: Record<CalendarIconKey, string> = {
  work: "Work",
  medical: "Medical",
  school: "School",
  sports: "Sports",
  car: "Car",
  home: "Home",
  sitter: "Babysitter",
  travel: "Travel",
  birthday: "Birthday",
  family: "Family",
  star: "Star",
  calendar: "Calendar",
};

/** Select value standing in for "no icon" (stored as null). */
export const CALENDAR_ICON_NONE = "none";

/** Same curated swatches the household already uses for members/categories. */
export const CALENDAR_COLORS = MEMBER_COLORS;

/** Deterministic default so calendars look reasonable with zero configuration. */
export function defaultCalendarColor(index: number): MemberColor {
  const rotation: MemberColor[] = ["sky", "sage", "lilac", "amber", "teal", "rose", "coral", "sand"];
  return rotation[Math.abs(index) % rotation.length] as MemberColor;
}

/**
 * Lightened fill used for calendars set to "Background": same chosen colour,
 * lower contrast, so coverage shading never competes with real event cards.
 * Written out statically so Tailwind can see every class.
 */
export const MUTED_CALENDAR_TINT: Record<MemberColor, string> = {
  sky: "bg-member-sky-soft/50",
  rose: "bg-member-rose-soft/50",
  amber: "bg-member-amber-soft/50",
  sage: "bg-member-sage-soft/50",
  teal: "bg-member-teal-soft/50",
  lilac: "bg-member-lilac-soft/50",
  coral: "bg-member-coral-soft/50",
  sand: "bg-member-sand-soft/50",
};

/** Subdued accent/swatch for the same background calendars. */
export const MUTED_CALENDAR_ACCENT: Record<MemberColor, string> = {
  sky: "bg-member-sky/50",
  rose: "bg-member-rose/50",
  amber: "bg-member-amber/50",
  sage: "bg-member-sage/50",
  teal: "bg-member-teal/50",
  lilac: "bg-member-lilac/50",
  coral: "bg-member-coral/50",
  sand: "bg-member-sand/50",
};

export function isCalendarIconKey(value: unknown): value is CalendarIconKey {
  return typeof value === "string" && (CALENDAR_ICON_KEYS as string[]).includes(value);
}

/** `null` / "none" clears the icon; anything unknown is rejected. */
export function assertCalendarIcon(value: unknown): CalendarIconKey | null {
  if (value === null || value === undefined || value === CALENDAR_ICON_NONE || value === "") {
    return null;
  }
  if (isCalendarIconKey(value)) return value;
  throw new Error("Choose an icon from the list");
}

export function assertCalendarColor(value: unknown): MemberColor {
  if (typeof value === "string" && (CALENDAR_COLORS as string[]).includes(value)) {
    return value as MemberColor;
  }
  throw new Error("Choose a color from the palette");
}
