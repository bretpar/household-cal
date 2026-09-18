/**
 * Single source of truth for the calendar timeline presentation.
 *
 * Every timed view (Day, 3-Day, Week — phone, tablet, desktop, portrait and
 * landscape) derives geometry, card styling and text density from the values
 * and functions in this file. Views only supply structure: which day columns
 * exist, how wide a column is, and how tall the container is.
 *
 * Rules encoded here:
 * - geometry always follows real time (never nudged to signal overlap);
 * - background/coverage events span the full column and never consume a
 *   foreground lane;
 * - foreground events only compete with other foreground events;
 * - what text is rendered depends on the card's actual width and height.
 */

import type { Occurrence } from "@/lib/family-data";

/* ------------------------------------------------------------------ tokens */

export const CALENDAR_TOKENS = {
  /** Timeline scale. Everything (events, now-line, drag snap, initial scroll)
   *  derives from this one value. */
  hourPx: 45,
  dayStartHour: 0,
  dayEndHour: 24,
  snapMinutes: 15,
  /** Time gutter widths; `compact` is used when day columns are phone-narrow. */
  gutter: { compact: 40, default: 52 },
  /** Minimum rendered event height so a one-line title is never clipped. */
  minEventHeightPx: 28,
  /** Real pointer/touch hit height for very short events. */
  tapTargetPx: 44,
  /** Flat calendar blocks: small radius, no floating-card shadow. */
  card: {
    radius: "rounded-[6px]",
    railWidth: "w-[3px]",
    border: "border border-border-soft",
    gapPx: 2,
  },
  /** Below this rendered width a card is too narrow to stay readable. */
  minCardWidthPx: 116,
  /** Content thresholds, measured against the card's rendered box. */
  content: {
    timeMinHeightPx: 40,
    timeMinWidthPx: 84,
    badgesMinWidthPx: 62,
    badgeWidthPx: 20,
    badgeReserveWidthPx: 58,
  },
  /** Background/coverage layer. */
  background: {
    /** Height of the single top-left label area. */
    labelHeightPx: 56,
    /** Rows of the label that must stay readable underneath a foreground card. */
    labelTextHeightPx: 30,
    /** Share of the column a foreground card may use when it sits directly on
     *  the background label, and when it only overlaps the block later. */
    foregroundWidthOverLabelPct: 72,
    foregroundWidthPct: 88,
  },
} as const;

/* ---------------------------------------------------------------- geometry */

export function topForTime(date: Date): number {
  return (
    (date.getHours() + date.getMinutes() / 60 - CALENDAR_TOKENS.dayStartHour) *
    CALENDAR_TOKENS.hourPx
  );
}

export function heightForOccurrence(o: Occurrence): number {
  const minutes = (o.end.getTime() - o.start.getTime()) / 60000;
  return Math.max(
    CALENDAR_TOKENS.minEventHeightPx,
    (minutes / 60) * CALENDAR_TOKENS.hourPx,
  );
}

export function heightForMinutes(minutes: number): number {
  return (minutes / 60) * CALENDAR_TOKENS.hourPx;
}

/** Long day-spanning blocks (school, work) render in the all-day band. */
export function isDayBlock(o: Occurrence): boolean {
  return o.event.all_day || (o.end.getTime() - o.start.getTime()) / 3600000 >= 5;
}

function overlaps(a: Occurrence, b: Occurrence): boolean {
  return a.start < b.end && a.end > b.start;
}

/* ------------------------------------------------------- background layout */

export interface BackgroundPlacement {
  occurrence: Occurrence;
  top: number;
  height: number;
  /** Single label block: top-left, never duplicated further down the event. */
  labelHeight: number;
  /** Narrow the label box when a foreground card sits over the label area. */
  labelWidth: string | undefined;
}

export function layoutBackground(
  coverage: Occurrence[],
  foreground: Occurrence[],
): BackgroundPlacement[] {
  return coverage.map((o) => {
    const height = heightForOccurrence(o);
    const labelHeight = Math.min(height, CALENDAR_TOKENS.background.labelHeightPx);
    const labelTextEnd = new Date(
      o.start.getTime() +
        (Math.min(labelHeight, CALENDAR_TOKENS.background.labelTextHeightPx) /
          CALENDAR_TOKENS.hourPx) *
          3_600_000,
    );
    const obscured = foreground.some((f) => f.start < labelTextEnd && f.end > o.start);
    return {
      occurrence: o,
      top: topForTime(o.start),
      height,
      labelHeight,
      labelWidth: obscured ? "clamp(96px, 38%, 132px)" : undefined,
    };
  });
}

/* ------------------------------------------------------- foreground layout */

interface Lane {
  occurrence: Occurrence;
  lane: number;
  cluster: number;
}

/** Greedy lane packing across foreground events only. */
function withLanes(list: Occurrence[]): Lane[] {
  const sorted = [...list].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.key.localeCompare(b.key),
  );
  const placed: Lane[] = [];
  let cluster: Lane[] = [];
  let clusterEnd = 0;
  let laneEnds: number[] = [];
  let clusterIndex = 0;

  const flush = () => {
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = 0;
    clusterIndex += 1;
  };

  for (const occurrence of sorted) {
    if (cluster.length > 0 && occurrence.start.getTime() >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => occurrence.start.getTime() >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = occurrence.end.getTime();
    clusterEnd = Math.max(clusterEnd, occurrence.end.getTime());
    cluster.push({ occurrence, lane, cluster: clusterIndex });
  }
  flush();
  return placed;
}

export interface ForegroundPlacement {
  occurrence: Occurrence;
  cluster: number;
  lane: number;
  /** Stable segment identity. One occurrence may have several width segments. */
  segment: number;
  /** Content appears once, on the first segment where this event is visible. */
  showContent: boolean;
  top: number;
  /** True visual height from the event's duration. */
  height: number;
  /** Percentage box inside the day column's event area. */
  leftPct: number;
  widthPct: number;
  /** Estimated rendered width in px, used for the content plan. */
  widthPx: number;
}

export interface OverflowMarker {
  cluster: number;
  segment: number;
  top: number;
  hidden: Occurrence[];
}

export interface TimedLayout {
  foreground: ForegroundPlacement[];
  overflow: OverflowMarker[];
}

/**
 * Lay out one day column.
 *
 * `areaWidth` is the pixel width available for event cards (the column minus
 * its own padding). Background coverage never takes a lane: it only limits how
 * much width a foreground card may claim when it would hide the background
 * label.
 */
export function layoutTimedEvents({
  foreground,
  coverage,
  areaWidth,
}: {
  foreground: Occurrence[];
  coverage: Occurrence[];
  areaWidth: number;
}): TimedLayout {
  const placed = withLanes(foreground);
  const results: ForegroundPlacement[] = [];
  const overflow: OverflowMarker[] = [];
  const shownContent = new Set<string>();
  const clusters = new Map<number, Lane[]>();
  for (const item of placed) {
    const cluster = clusters.get(item.cluster) ?? [];
    cluster.push(item);
    clusters.set(item.cluster, cluster);
  }

  for (const [cluster, items] of clusters) {
    const boundaries = [
      ...new Set(items.flatMap(({ occurrence }) => [occurrence.start.getTime(), occurrence.end.getTime()])),
    ].sort((a, b) => a - b);

    for (let segment = 0; segment < boundaries.length - 1; segment += 1) {
      const segmentStart = boundaries[segment];
      const segmentEnd = boundaries[segment + 1];
      if (segmentStart == null || segmentEnd == null || segmentStart >= segmentEnd) continue;

      const active = items
        .filter(
          ({ occurrence }) =>
            occurrence.start.getTime() < segmentEnd && occurrence.end.getTime() > segmentStart,
        )
        .sort((a, b) => a.lane - b.lane || a.occurrence.key.localeCompare(b.occurrence.key));
      if (active.length === 0) continue;

      // Background coverage remains a separate layer. It can reserve a left
      // label strip, but it never consumes a foreground lane or overflow slot.
      let areaLeftPct = 0;
      let areaWidthPct = 100;
      const segmentStartDate = new Date(segmentStart);
      const segmentEndDate = new Date(segmentEnd);
      const covering = coverage.filter(
        (background) => background.start < segmentEndDate && background.end > segmentStartDate,
      );
      if (covering.length > 0) {
        const onLabel = covering.some((background) => {
          const labelHeight = Math.min(
            heightForOccurrence(background),
            CALENDAR_TOKENS.background.labelHeightPx,
          );
          const labelMinutes =
            (Math.min(labelHeight, CALENDAR_TOKENS.background.labelTextHeightPx) /
              CALENDAR_TOKENS.hourPx) *
            60;
          const labelEnd = new Date(background.start.getTime() + labelMinutes * 60_000);
          return segmentStartDate < labelEnd && segmentEndDate > background.start;
        });
        areaWidthPct = onLabel
          ? CALENDAR_TOKENS.background.foregroundWidthOverLabelPct
          : CALENDAR_TOKENS.background.foregroundWidthPct;
        areaLeftPct = 100 - areaWidthPct;
      }

      const usableWidth = (areaWidth * areaWidthPct) / 100;
      const widthCapacity = Math.max(
        1,
        Math.floor(
          Math.max(usableWidth, 1) /
            (CALENDAR_TOKENS.minCardWidthPx + CALENDAR_TOKENS.card.gapPx),
        ),
      );
      // Two overlapping activities are always represented by two real cards.
      // At higher densities, actual available width alone determines capacity.
      const visibleCount =
        active.length <= 2 ? active.length : Math.max(2, Math.min(active.length, widthCapacity));
      const visible = active.slice(0, visibleCount);
      const hidden = active.slice(visibleCount).map(({ occurrence }) => occurrence);
      const laneWidthPct = areaWidthPct / visibleCount;

      visible.forEach((item, visibleLane) => {
        const showContent = !shownContent.has(item.occurrence.key);
        shownContent.add(item.occurrence.key);
        results.push({
          occurrence: item.occurrence,
          cluster,
          lane: visibleLane,
          segment,
          showContent,
          top: topForTime(segmentStartDate),
          height: heightForMinutes((segmentEnd - segmentStart) / 60_000),
          leftPct: areaLeftPct + visibleLane * laneWidthPct,
          widthPct: laneWidthPct,
          widthPx: Math.max(
            0,
            (areaWidth * laneWidthPct) / 100 - CALENDAR_TOKENS.card.gapPx,
          ),
        });
      });

      if (hidden.length > 0) {
        overflow.push({
          cluster,
          segment,
          hidden,
          top: topForTime(segmentStartDate),
        });
      }
    }
  }

  return { foreground: results, overflow };
}

/* ------------------------------------------------------------ content plan */

export type EventTextScale = "compact" | "regular";

export interface EventContentPlan {
  scale: EventTextScale;
  /** Which rows fit: title always, then time, then badges. */
  showTime: boolean;
  showBadges: boolean;
  /** Collapse to +N only when the width genuinely cannot fit every badge. */
  maxBadges: number | undefined;
  padding: string;
}

/**
 * Adaptive content rules shared by every timeline view. Priority is always
 * title, then compact time, then member badges — decided by the card's actual
 * rendered box, not by device or view.
 */
export function planEventContent({
  width,
  height,
  badgeCount,
}: {
  width: number;
  height: number;
  badgeCount: number;
}): EventContentPlan {
  const c = CALENDAR_TOKENS.content;
  const scale: EventTextScale = width >= 200 ? "regular" : "compact";
  const showTime = height >= c.timeMinHeightPx && width >= c.timeMinWidthPx;
  const fits = Math.floor(
    Math.max(0, width - c.badgeReserveWidthPx) / c.badgeWidthPx,
  );
  const showBadges = width >= c.badgesMinWidthPx && fits >= 1 && badgeCount > 0;
  const maxBadges = showBadges && fits < badgeCount ? Math.max(1, fits) : undefined;
  const padding =
    height >= 54 ? "px-1.5 py-1" : height >= 36 ? "px-1.5 py-0.5" : "px-1.5 py-px";

  return { scale, showTime, showBadges, maxBadges, padding };
}

export const EVENT_TEXT_SCALE: Record<
  EventTextScale,
  { title: string; time: string; badge: "xs" | "sm" | "base" }
> = {
  compact: {
    title: "text-[13px] leading-tight font-semibold",
    time: "text-[11px] leading-tight font-normal",
    badge: "xs",
  },
  regular: {
    title: "text-sm leading-tight font-semibold",
    time: "text-xs leading-tight font-normal",
    badge: "sm",
  },
};
