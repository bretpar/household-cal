/**
 * Typography for the non-timeline calendar surfaces (Month grid chips and the
 * agenda/list cards).
 *
 * Timed views (Day / 3-Day / Week, every screen size and orientation) do NOT
 * use this file: their geometry, card styling and adaptive content rules live
 * in `src/lib/calendar-layout.ts`, which is the single source of truth for the
 * timeline. Only the shared time-tone helper is used by both.
 */

export type CalendarViewScale = "month" | "day";

export interface EventTypeScale {
  /** Fixed title style for the surface. */
  title: string;
  /** Fixed time/details style for the surface. */
  time: string;
  /** Member badge size token (see MemberBadge). */
  badge: "xs" | "sm" | "base";
  /** Two padding steps: normal and crowded. */
  padding: { medium: string; tiny: string };
}

export const EVENT_TYPE_SCALE: Record<CalendarViewScale, EventTypeScale> = {
  day: {
    title: "text-[15px] leading-tight font-semibold",
    time: "text-[13px] leading-tight font-normal",
    badge: "base",
    padding: { medium: "px-2.5 py-1.5", tiny: "px-2 py-px" },
  },
  month: {
    title: "text-[11px] leading-tight font-semibold",
    time: "text-[11px] leading-tight font-normal",
    badge: "xs",
    padding: { medium: "px-1.5 py-0.5", tiny: "px-1 py-px" },
  },
};

/** Text colour for time/details; muted sources keep the size, lose the contrast. */
export function eventTimeToneClass(muted: boolean): string {
  return muted ? "text-coverage-foreground/80" : "text-muted-foreground";
}
