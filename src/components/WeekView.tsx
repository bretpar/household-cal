import type { DragEvent, Ref } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";

import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { eventTintClass } from "@/lib/event-colors";
import { eventTypeIcons } from "@/components/EventCard";
import { CalendarEventContent } from "@/components/CalendarEventContent";
import {
  densityForHeight,
  EVENT_TYPE_SCALE,
  type CalendarViewScale,
  type EventDensity,
} from "@/lib/event-typography";
import { useReschedule } from "@/components/useReschedule";
import { useTimeGridDrag } from "@/hooks/use-time-grid-drag";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  expandOccurrences,
  formatTimeRange,
  isChildcare,
  isCoverage,
  occurrenceMatchesFilter,
  type CalendarEvent,
  type MemberId,
  type Occurrence,
} from "@/lib/family-data";

/** Responsive density for timed events in Week/Day view.
 *  Mobile keeps the aggressive compact rules. Desktop/tablet has enough
 *  horizontal room to show the title + time for events ~30 min and up. */
function timedEventDensity(
  view: CalendarViewScale,
  height: number,
  isMobile: boolean,
): EventDensity {
  if (isMobile) return densityForHeight(view, height);
  if (view === "week") {
    if (height >= 70) return "full";
    if (height >= 30) return "medium"; // 30 min -> title + time
    if (height >= 20) return "short";
    return "tiny";
  }
  return densityForHeight(view, height);
}

/** Full 24-hour timeline so overnight and early-morning events are visible. */
const DAY_START = 0;
const DAY_END = 24;
const HOUR_PX = 60;
/** Drops snap to a friendly grid rather than to the exact pixel. */
const SNAP_MINUTES = 15;

function topFor(date: Date) {
  return (date.getHours() + date.getMinutes() / 60 - DAY_START) * HOUR_PX;
}

function heightFor(o: Occurrence) {
  const minutes = (o.end.getTime() - o.start.getTime()) / 60000;
  return Math.max(28, (minutes / 60) * HOUR_PX);
}

/** Long, day-spanning blocks (school, work) render as banner chips instead of tall columns. */
function isDayBlock(o: Occurrence): boolean {
  return o.event.all_day || (o.end.getTime() - o.start.getTime()) / 3600000 >= 5;
}

function hourLabel(hour: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

function minutesFromTop(px: number) {
  return (px / HOUR_PX) * 60;
}

interface Placed {
  occurrence: Occurrence;
  lane: number;
  laneCount: number;
}

/** Greedy lane packing so overlapping events render side by side instead of stacked. */
function withLanes(list: Occurrence[]): Placed[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = 0;
  let laneEnds: number[] = [];

  const flush = () => {
    const count = Math.max(1, laneEnds.length);
    cluster.forEach((item) => (item.laneCount = count));
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = 0;
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
    cluster.push({ occurrence, lane, laneCount: 1 });
  }
  flush();
  return placed;
}

export function WeekView({
  anchor,
  events,
  selectedMembers,
  days = 7,
  onCreateRange,
  bare = false,
  fill = false,
  active = true,
  onTimelineScroll,
  onEventDragChange,
  recenterSignal = 0,
  dayWidth,
  scrollHostRef,
}: {
  anchor: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  days?: number;
  /** press-and-hold on empty grid space; only when the user may create events */
  onCreateRange?: ((start: Date, end: Date) => void) | undefined;
  /** render without the card frame (parent supplies a stationary one) */
  bare?: boolean;
  /** fill the parent's height; only the hourly timeline scrolls */
  fill?: boolean;
  /** only the visible page may choose an automatic initial hour */
  active?: boolean;
  /** keeps pre-rendered neighbouring timelines at the same vertical position */
  onTimelineScroll?: ((scrollTop: number, source: HTMLDivElement) => void) | undefined;
  /** true while a long-pressed event is being dragged, so the pager stands down */
  onEventDragChange?: ((dragging: boolean) => void) | undefined;
  /** increment to re-position the timeline around the current time (Today button) */
  recenterSignal?: number | undefined;
  /**
   * Continuous day-strip mode: each day column gets this fixed pixel width and
   * the whole view becomes one horizontally scrollable track of day columns.
   */
  dayWidth?: number | undefined;
  /** the horizontal scroll surface for day-strip mode */
  scrollHostRef?: Ref<HTMLDivElement> | undefined;
}) {

  const { openOccurrence, categoryAppearanceFor, sources } = useCalendar();
  const { dragProps, dropProps, draggingKey, requestMove, dialog } = useReschedule();
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sourceName = (id: string | null) => sources.find((s) => s.id === id)?.name ?? "Coverage";
  /** Childcare joins the soft care-coverage layer instead of competing as a card. */
  const isCareLayer = (o: Occurrence) =>
    isCoverage(o.event) || (isChildcare(o.event) && !o.event.all_day);
  const careLabel = (o: Occurrence) =>
    isChildcare(o.event) ? o.event.title : sourceName(o.event.calendar_source_id);
  /** Rolling window: the selected date is always the left-most column. */
  /** One column = Day view, which gets the slightly larger shared type scale. */
  const viewScale = days === 1 ? "day" : "week";
  const start = anchor;
  const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occurrences = expandOccurrences(events, columns[0]!, addDays(columns[days - 1]!, 1));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  /** Pointer position inside a day column -> snapped start time on that day. */
  const startFromDrop = (day: Date, e: DragEvent<HTMLElement>): Date => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutesFromTop = ((e.clientY - rect.top) / HOUR_PX) * 60;
    const total = Math.max(
      0,
      Math.min(DAY_END * 60 - SNAP_MINUTES, minutesFromTop),
    );
    const snapped = Math.round(total / SNAP_MINUTES) * SNAP_MINUTES;
    const next = new Date(day);
    next.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0);
    return next;
  };

  // Press-and-hold to lift a preview block: empty space creates a 1-hour draft,
  // an existing event lifts itself keeping its duration. Release opens the form.
  const occurrenceByKey = new Map(occurrences.map((o) => [o.key, o]));
  const { ghost, columnProps, dragging } = useTimeGridDrag({
    enabled: Boolean(onCreateRange),
    hourPx: HOUR_PX,
    dayStartHour: DAY_START,
    dayEndHour: DAY_END,
    snapMinutes: SNAP_MINUTES,
    resolveOccurrence: (key) => occurrenceByKey.get(key),
    scrollContainerRef: scrollRef,
    onDragStateChange: onEventDragChange,
    // Coverage is now an explicit small label zone, so every type shares one hold timing.
    onCreate: (start, end) => onCreateRange?.(start, end),
    // Releasing commits the new time straight away (recurring events still ask scope).
    onMove: (occurrence, start) => requestMove(occurrence, start),
  });


  const ghostTimes = ghost
    ? (() => {
        const start = new Date(ghost.day);
        start.setHours(Math.floor(ghost.startMinutes / 60), ghost.startMinutes % 60, 0, 0);
        const end = new Date(start.getTime() + ghost.durationMinutes * 60000);
        return { start, end, label: formatTimeRange(start, end, false) };
      })()
    : null;

  /** Day-block / all-day chips keep their time of day and only change day. */
  const sameTimeOn = (day: Date, occurrence: Occurrence): Date => {
    const next = new Date(day);
    next.setHours(occurrence.start.getHours(), occurrence.start.getMinutes(), 0, 0);
    return next;
  };

  const [now, setNow] = useState(() => new Date());


  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Position the timeline so the first visible time is ~1 hour before the
  // current local time, clamped to the end of the day (never past 11:59 PM,
  // never blank space below). Runs once when this view is first entered;
  // afterwards the user's manual scroll position is preserved across date
  // changes and horizontal swipes. Pressing Today bumps recenterSignal.
  const didAutoPosition = useRef(false);
  const positionNearNow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    didAutoPosition.current = true;
    const targetTop = topFor(new Date()) - HOUR_PX;
    const maxScroll = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: Math.max(0, Math.min(maxScroll, targetTop)), behavior: "auto" });
  }, []);

  // Initial open / entering this timed view (any screen size).
  useEffect(() => {
    if (!active || didAutoPosition.current) return;
    positionNearNow();
  }, [active, positionNearNow]);

  // Explicit recenter when the user presses Today.
  useEffect(() => {
    if (!active || recenterSignal === 0) return;
    positionNearNow();
  }, [recenterSignal, active, positionNearNow]);

  const todayColumnIndex = columns.findIndex((day) => isSameDay(day, now));
  const nowTop = topFor(now);

  return (
    <>
      {dialog}
      <div
        className={cn(
          "calendar-gesture-surface overflow-hidden",
          fill && "flex min-h-0 flex-1 flex-col",
          !bare && "rounded-3xl border border-border-soft bg-surface shadow-soft",
        )}
      >
        <div
          className="grid shrink-0 border-b border-border-soft bg-surface-muted"
          style={{ gridTemplateColumns: `3.25rem repeat(${days}, minmax(0,1fr))` }}
        >
          <div />
          {columns.map((day) => (
            <div key={day.toISOString()} className="px-1 py-1 text-center">
              <p className="text-[10px] leading-none font-bold tracking-wide text-muted-foreground uppercase">
                {format(day, "EEE")}
              </p>
              <p
                className={cn(
                  "mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[13px] leading-none font-bold",
                  isSameDay(day, new Date()) && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </p>
            </div>
          ))}
        </div>

        {/* all-day row */}
        <div
          className="grid shrink-0 border-b border-border-soft"
          style={{ gridTemplateColumns: `3.25rem repeat(${days}, minmax(0,1fr))` }}
        >
          <div className="py-1.5 pr-1 text-right text-[10px] font-semibold text-muted-foreground">
            Day
          </div>
          {columns.map((day) => {
            const allDay = occurrences.filter(
              (o) =>
                isDayBlock(o) &&
                !isCareLayer(o) &&
                isSameDay(o.start, day) &&
                occurrenceMatchesFilter(o, selectedMembers),
            );
            return (
              <div
                key={day.toISOString()}
                className="min-h-7 space-y-0.5 border-l border-border-soft p-1"
                {...dropProps((_e, o) => sameTimeOn(day, o))}
              >
                {/* Background commitments (school, work): same type scale as timed
                  events, differentiated by lower contrast only. */}
                {allDay.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    {...dragProps(o)}
                    onClick={() => openOccurrence(o)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md text-left opacity-80 transition-opacity hover:opacity-100",
                      EVENT_TYPE_SCALE[viewScale].padding.tiny,
                      draggingKey === o.key && "opacity-40",
                      eventTintClass(categoryAppearanceFor(o.event)),
                    )}
                  >
                    <span
                      className={cn("min-w-0 flex-1 truncate", EVENT_TYPE_SCALE[viewScale].title)}
                    >
                      {o.event.title}
                    </span>
                    <MemberBadgeRow ids={o.member_ids} size={EVENT_TYPE_SCALE[viewScale].badge} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div
          ref={scrollRef}
          data-calendar-timeline
          onScroll={(event) => {
            // Any scroll (manual or synced from a neighbouring timeline) means
            // this timeline's position is established — don't auto-position later.
            didAutoPosition.current = true;
            onTimelineScroll?.(event.currentTarget.scrollTop, event.currentTarget);
          }}
          className={cn(
            "overflow-y-auto overflow-x-hidden overscroll-y-contain",
            fill ? "min-h-0 flex-1" : "max-h-[70vh]",
          )}
          // Vertical panning belongs to this timeline; horizontal panning must
          // reach the period carousel instead of being swallowed here.
          style={{ touchAction: dragging ? "none" : "pan-y" }}

        >
          <div
            className="relative grid"
            style={{ gridTemplateColumns: `3.25rem repeat(${days}, minmax(0,1fr))` }}
          >
            <div className="relative">
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={{ height: HOUR_PX }}
                  className="pr-1.5 text-right text-[10px] font-semibold text-muted-foreground"
                >
                  <span className="relative -top-1.5">{hourLabel(hour)}</span>
                </div>
              ))}
              {todayColumnIndex !== -1 && (
                <div
                  className="absolute right-0 z-20 flex -translate-y-1/2 items-center pr-1"
                  style={{ top: nowTop }}
                >
                  <span className="rounded bg-brand-coral px-1 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {format(now, "h:mm a")}
                  </span>
                </div>
              )}
            </div>

            {columns.map((day) => {
              const dayOccurrences = occurrences.filter((o) => isSameDay(o.start, day));
              const coverage = dayOccurrences.filter((o) => isCareLayer(o));
              const visible = dayOccurrences.filter(
                (o) =>
                  !isCareLayer(o) && !isDayBlock(o) && occurrenceMatchesFilter(o, selectedMembers),
              );

              return (
                <div
                  key={day.toISOString()}
                  className="relative border-l border-border-soft"
                  style={{ height: hours.length * HOUR_PX }}
                  {...dropProps((e) => startFromDrop(day, e))}
                  {...columnProps(day)}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      style={{ height: HOUR_PX }}
                      className="border-b border-border-soft/60"
                    />
                  ))}

                  {/* Live current-time indicator for today only. */}
                  {isSameDay(day, now) && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10"
                      style={{ top: nowTop }}
                      aria-hidden
                    >
                      <div className="absolute -left-[3px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-brand-coral ring-2 ring-surface" />
                      <div className="h-px w-full bg-brand-coral" />
                    </div>
                  )}

                  {/* Babysitter coverage: warm neutral shading across the whole scheduled range.
                    The shaded body is inert (long-press there creates a normal event, like
                    blank calendar space); only the small header label is interactive. */}
                  {coverage.map((o) => {
                    const moving = draggingKey === o.key || ghost?.occurrence?.key === o.key;
                    const blockHeight = heightFor(o);
                    // Background coverage uses the SAME type scale as any other
                    // event in this view — only the colour is muted. The label
                    // area is capped so long shifts stay readable underneath.
                    const labelHeight = Math.min(blockHeight, 56);
                    const density = densityForHeight(viewScale, labelHeight);
                    return (
                      <div
                        key={o.key}
                        className={cn(
                          "pointer-events-none absolute inset-x-0 border-y border-coverage-strong/40",
                          isChildcare(o.event) ? "bg-coverage/45" : "bg-coverage/60",
                          // Subtle selected state: outline only, keeps the coverage colour.
                          moving && "ring-2 ring-coverage-strong/70 ring-inset",
                        )}
                        style={{ top: topFor(o.start), height: blockHeight }}
                        aria-label={`${careLabel(o)} ${formatTimeRange(o.start, o.end, false)}`}
                      >
                        <div
                          {...(isChildcare(o.event)
                            ? { "data-occurrence-key": o.key, ...dragProps(o) }
                            : {})}
                          className={cn(
                            "absolute inset-x-0 top-0 text-coverage-foreground",
                            isChildcare(o.event) && "pointer-events-auto touch-hit-44",
                          )}
                          style={{ height: labelHeight }}
                        >
                          <CalendarEventContent
                            occurrence={o}
                            view={viewScale}
                            density={density}
                            muted
                            title={careLabel(o)}
                            onOpen={isChildcare(o.event) ? () => openOccurrence(o) : undefined}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Timed events sit above the coverage layer in side-by-side lanes.
                    The block body is the move (long-press) target; only the text
                    label opens details on tap. */}
                  <div className="pointer-events-none absolute inset-y-0 right-1 left-3 sm:left-4">
                    {withLanes(visible).map(({ occurrence: o, lane, laneCount }) => {
                      const Icon = eventTypeIcons[o.event.event_type];
                      const blockHeight = heightFor(o);
                      // Height decides which rows are shown — never the font size.
                      // On desktop/tablet there is enough room to keep title + time
                      // for events ~30 min and up; mobile keeps the compact rules.
                      const density = timedEventDensity(viewScale, blockHeight, isMobile);
                      const compact = density === "tiny" || density === "short";
                      return (
                        <div
                          key={o.key}
                          data-occurrence-key={o.key}
                          {...dragProps(o)}
                          className={cn(
                            "pointer-events-auto touch-hit-44 absolute text-left",
                            compact ? "rounded-md" : "rounded-xl",
                            draggingKey === o.key && "opacity-40",
                            // Lifted by a long press: fade the original in place.
                            ghost?.occurrence?.key === o.key && "opacity-30",
                          )}
                          style={{
                            top: topFor(o.start),
                            height: blockHeight,
                            left: `calc(${(lane / laneCount) * 100}% + 1px)`,
                            width: `calc(${100 / laneCount}% - 2px)`,
                          }}
                        >
                          <div
                            className={cn(
                              "absolute inset-0 overflow-hidden border border-border-soft shadow-soft",
                              compact ? "rounded-md" : "rounded-xl",
                              eventTintClass(categoryAppearanceFor(o.event)),
                            )}
                          >
                            <CalendarEventContent
                              occurrence={o}
                              view={viewScale}
                              density={density}
                              icon={Icon}
                              onOpen={() => openOccurrence(o)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live drag preview: never persisted, replaced by the real form on release.
                    Long coverage shifts stay unfilled so the day is still readable. */}
                  {ghost && ghostTimes && isSameDay(ghost.day, day)
                    ? (() => {
                        const isCare = Boolean(ghost.occurrence && isCareLayer(ghost.occurrence));
                        return (
                          <div
                            className={cn(
                              "pointer-events-none absolute inset-x-1 z-30 scale-[1.03] rounded-xl border-2 px-1.5 py-1 shadow-lg ring-2 ring-primary/40 transition-transform",
                              isCare
                                ? "border-coverage-strong/80 bg-coverage/70"
                                : "border-primary bg-primary/25",
                            )}
                            style={{
                              top: (ghost.startMinutes / 60 - DAY_START) * HOUR_PX,
                              height: (ghost.durationMinutes / 60) * HOUR_PX,
                            }}
                          >
                            <p
                              className={cn(
                                "inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 text-[10px] font-bold",
                                isCare ? "bg-surface/85 text-coverage-foreground" : "text-primary",
                              )}
                            >
                              {ghost.kind === "move" && ghost.occurrence
                                ? ghost.occurrence.event.title
                                : "New event"}
                              <span className="font-semibold opacity-80">{ghostTimes.label}</span>
                            </p>
                          </div>
                        );
                      })()
                    : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
