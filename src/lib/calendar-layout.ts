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
  /** Preferred readable width for a card that has the column to itself. */
  minCardWidthPx: 116,
  /** Absolute floor for an overlap column: still readable and tappable. Cards
   *  are narrowed down to this before any event is pushed into "+N more". */
  minOverlapColumnPx: 52,

  /** Content thresholds, measured against the card's rendered box. */
  content: {
    timeMinHeightPx: 40,
    timeMinWidthPx: 64,
    badgesMinWidthPx: 116,
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

/**
 * Long day-spanning blocks (school, work) render in the all-day band.
 * Imported read-only subscription events follow their own flag only: a timed
 * feed event stays on the timeline no matter how long it runs.
 */
export function isDayBlock(o: Occurrence): boolean {
  if (o.event.all_day) return true;
  if (o.event.read_only) return false;
  return (o.end.getTime() - o.start.getTime()) / 3600000 >= 5;
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
  /** Small left inset (Apple-style step) so an earlier background block's rail
   *  stays visible underneath a later overlapping one. */
  indentPx: number;
  /** Stacking order within the background layer: deeper tiers paint on top. */
  tier: number;
}

/** Left step per overlapping background tier — just enough to read the rail. */
export const BACKGROUND_INDENT_PX = 12;
/** Beyond this the step stops growing so labels keep their room. */
const BACKGROUND_MAX_TIER = 3;

export function layoutBackground(
  coverage: Occurrence[],
  foreground: Occurrence[],
): BackgroundPlacement[] {
  /** Tier = how many earlier background blocks this one still overlaps. */
  const ordered = [...coverage].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()) ||
      a.key.localeCompare(b.key),
  );
  const tiers = new Map<string, number>();
  ordered.forEach((o, index) => {
    const overlapping = ordered
      .slice(0, index)
      .filter((prev) => prev.start < o.end && prev.end > o.start);
    const used = new Set(overlapping.map((prev) => tiers.get(prev.key) ?? 0));
    let tier = 0;
    while (used.has(tier) && tier < BACKGROUND_MAX_TIER) tier += 1;
    tiers.set(o.key, tier);
  });

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
    const tier = tiers.get(o.key) ?? 0;
    return {
      occurrence: o,
      top: topForTime(o.start),
      height,
      labelHeight,
      labelWidth: obscured ? "clamp(96px, 38%, 132px)" : undefined,
      indentPx: tier * BACKGROUND_INDENT_PX,
      tier,
    };
  });
}


/* ------------------------------------------------------- foreground layout */

interface Lane {
  occurrence: Occurrence;
  lane: number;
  cluster: number;
}

/**
 * Stable foreground lane packing.
 *
 * Priority is decided once per overlap group: earlier start, then longer
 * duration, then the occurrence key. An event keeps its lane for its whole
 * duration (never re-flowed mid-event), but a lane whose previous event has
 * already ended is reused, so a chain of partial overlaps does not inflate the
 * lane count past the number of events that are genuinely concurrent.
 */
function withLanes(list: Occurrence[]): Lane[] {
  const sorted = [...list].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()) ||
      a.key.localeCompare(b.key),
  );
  const placed: Lane[] = [];
  let cluster: Lane[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
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
    const free = laneEnds.findIndex((end) => end <= occurrence.start.getTime());
    const lane = free === -1 ? laneEnds.length : free;
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
  /** Kept for stable renderer and overflow identities. Foreground cards use 0. */
  segment: number;
  startsEvent: boolean;
  endsEvent: boolean;
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
  const clusters = new Map<number, Lane[]>();
  for (const item of placed) {
    const cluster = clusters.get(item.cluster) ?? [];
    cluster.push(item);
    clusters.set(item.cluster, cluster);
  }

  for (const [cluster, items] of clusters) {
    const laneCount = Math.max(...items.map((item) => item.lane)) + 1;

    // Background coverage remains a separate full-width layer. It can reserve
    // a stable left label strip, but never consumes a foreground lane.
    const covering = coverage.filter((background) =>
      items.some(
        ({ occurrence }) => occurrence.start < background.end && occurrence.end > background.start,
      ),
    );
    const overLabel = covering.some((background) => {
      const labelHeight = Math.min(
        heightForOccurrence(background),
        CALENDAR_TOKENS.background.labelHeightPx,
      );
      const labelMinutes =
        (Math.min(labelHeight, CALENDAR_TOKENS.background.labelTextHeightPx) /
          CALENDAR_TOKENS.hourPx) *
        60;
      const labelEnd = new Date(background.start.getTime() + labelMinutes * 60_000);
      return items.some(
        ({ occurrence }) => occurrence.start < labelEnd && occurrence.end > background.start,
      );
    });
    const areaWidthPct = overLabel
      ? CALENDAR_TOKENS.background.foregroundWidthOverLabelPct
      : covering.length > 0
        ? CALENDAR_TOKENS.background.foregroundWidthPct
        : 100;
    const areaLeftPct = 100 - areaWidthPct;
    const usableWidth = (areaWidth * areaWidthPct) / 100;
    // Cards are allowed to get narrow (down to a still-tappable floor) before
    // any event is hidden: seeing every event's time and duration matters more
    // than keeping cards wide.
    const widthCapacity = Math.max(
      1,
      Math.floor(
        Math.max(usableWidth, 1) /
          (CALENDAR_TOKENS.minOverlapColumnPx + CALENDAR_TOKENS.card.gapPx),
      ),
    );
    const visibleCount =
      laneCount <= 2 ? laneCount : Math.max(2, Math.min(laneCount, widthCapacity));
    const laneWidthPct = areaWidthPct / visibleCount;

    items
      .filter((item) => item.lane < visibleCount)
      .forEach((item) => {
        results.push({
          occurrence: item.occurrence,
          cluster,
          lane: item.lane,
          segment: 0,
          startsEvent: true,
          endsEvent: true,
          showContent: true,
          top: topForTime(item.occurrence.start),
          height: heightForOccurrence(item.occurrence),
          leftPct: areaLeftPct + item.lane * laneWidthPct,
          widthPct: laneWidthPct,
          widthPx: Math.max(
            0,
            (areaWidth * laneWidthPct) / 100 - CALENDAR_TOKENS.card.gapPx,
          ),
        });
      });

    // One overflow affordance per overlap group, listing each hidden event once.
    // Per-boundary markers used to repeat the same event as several "+1 more"
    // pills down its duration.
    const hiddenByKey = new Map<string, Occurrence>();
    for (const item of items) {
      if (item.lane >= visibleCount && !hiddenByKey.has(item.occurrence.key)) {
        hiddenByKey.set(item.occurrence.key, item.occurrence);
      }
    }
    const hidden = [...hiddenByKey.values()];
    if (hidden.length > 0) {
      const firstStart = Math.min(...hidden.map((o) => o.start.getTime()));
      overflow.push({
        cluster,
        segment: 0,
        hidden,
        top: topForTime(new Date(firstStart)),
      });
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
  const showBadges =
    showTime && width >= c.badgesMinWidthPx && fits >= 1 && badgeCount > 0;
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
