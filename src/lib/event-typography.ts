/**
 * Single source of truth for calendar event typography.
 *
 * Rules this file encodes:
 * - font sizes are fixed per view (Month / Week / Day) and never shrink with
 *   an event's duration;
 * - an event's rendered height only decides *what* content is shown and how
 *   tight the padding is;
 * - secondary/background sources (Google, coverage, childcare) reuse the exact
 *   same scale and differentiate through muted colour only.
 */

export type CalendarViewScale = "month" | "week" | "day";

/** Which pieces of content fit, from richest to a single truncated line. */
export type EventDensity = "full" | "medium" | "short" | "tiny";

export interface EventTypeScale {
  /** Fixed title style for the view. */
  title: string;
  /** Fixed time/details style for the view. */
  time: string;
  /** Member badge size token (see MemberBadge). */
  badge: "xs" | "sm" | "base";
  /** Padding per density — the only thing that changes with height. */
  padding: Record<EventDensity, string>;
  /** Icon size; icons are decoration and get dropped below `full`. */
  icon: string;
}

export const EVENT_TYPE_SCALE: Record<CalendarViewScale, EventTypeScale> = {
  week: {
    title: "text-sm leading-tight font-semibold",
    time: "text-xs leading-tight font-normal",
    badge: "sm",
    padding: {
      full: "px-2 py-1.5",
      medium: "px-2 py-1",
      short: "px-1.5 py-0.5",
      tiny: "px-1.5 py-px",
    },
    icon: "h-3.5 w-3.5",
  },
  day: {
    title: "text-[15px] leading-tight font-semibold",
    time: "text-[13px] leading-tight font-normal",
    badge: "base",
    padding: {
      full: "px-2.5 py-2",
      medium: "px-2.5 py-1.5",
      short: "px-2 py-1",
      tiny: "px-2 py-px",
    },
    icon: "h-4 w-4",
  },
  month: {
    title: "text-[11px] leading-tight font-semibold",
    time: "text-[11px] leading-tight font-normal",
    badge: "xs",
    padding: {
      full: "px-1.5 py-1",
      medium: "px-1.5 py-0.5",
      short: "px-1.5 py-0.5",
      tiny: "px-1 py-px",
    },
    icon: "h-3 w-3",
  },
};

/**
 * Minimum rendered height (px) required for each density tier.
 * Derived from the fixed type scale so text is never clipped mid-line.
 */
const DENSITY_STEPS: Record<CalendarViewScale, { full: number; medium: number; short: number }> = {
  week: { full: 76, medium: 54, short: 34 },
  day: { full: 84, medium: 60, short: 38 },
  month: { full: 40, medium: 30, short: 20 },
};

export function densityForHeight(view: CalendarViewScale, height: number): EventDensity {
  const steps = DENSITY_STEPS[view];
  if (height >= steps.full) return "full";
  if (height >= steps.medium) return "medium";
  if (height >= steps.short) return "short";
  return "tiny";
}

/** Text colour for time/details; muted sources keep the size, lose the contrast. */
export function eventTimeToneClass(muted: boolean): string {
  return muted ? "text-coverage-foreground/80" : "text-muted-foreground";
}
