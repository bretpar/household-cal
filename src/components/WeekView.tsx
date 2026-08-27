import type { DragEvent } from "react";
import { addDays, format, isSameDay } from "date-fns";

import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { eventTintClass } from "@/lib/event-colors";
import { eventTypeIcons } from "@/components/EventCard";
import { useReschedule } from "@/components/useReschedule";
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

const DAY_START = 7;
const DAY_END = 22;
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

/** "8–5" style compact range for the babysitter coverage label. */
function compactRange(start: Date, end: Date) {
  const part = (d: Date) => {
    const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    return d.getMinutes() === 0 ? `${h}` : `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${part(start)}–${part(end)}`;
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
}: {
  anchor: Date;
  events: CalendarEvent[];
  selectedMembers: MemberId[];
  days?: number;
}) {
  const { openOccurrence, categoryAppearanceFor, sources } = useCalendar();
  const { dragProps, dropProps, draggingKey, dialog } = useReschedule();
  const sourceName = (id: string | null) =>
    sources.find((s) => s.id === id)?.name ?? "Coverage";
  /** Childcare joins the soft care-coverage layer instead of competing as a card. */
  const isCareLayer = (o: Occurrence) =>
    isCoverage(o.event) || (isChildcare(o.event) && !o.event.all_day);
  const careLabel = (o: Occurrence) =>
    isChildcare(o.event) ? o.event.title : sourceName(o.event.calendar_source_id);
  /** Rolling window: the selected date is always the left-most column. */
  const start = anchor;
  const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occurrences = expandOccurrences(events, columns[0]!, addDays(columns[days - 1]!, 1));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  /** Pointer position inside a day column -> snapped start time on that day. */
  const startFromDrop = (day: Date, e: DragEvent<HTMLElement>): Date => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutesFromTop = ((e.clientY - rect.top) / HOUR_PX) * 60;
    const total = Math.max(
      DAY_START * 60,
      Math.min(DAY_END * 60 - SNAP_MINUTES, DAY_START * 60 + minutesFromTop),
    );
    const snapped = Math.round(total / SNAP_MINUTES) * SNAP_MINUTES;
    const next = new Date(day);
    next.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0);
    return next;
  };

  /** Day-block / all-day chips keep their time of day and only change day. */
  const sameTimeOn = (day: Date, occurrence: Occurrence): Date => {
    const next = new Date(day);
    next.setHours(occurrence.start.getHours(), occurrence.start.getMinutes(), 0, 0);
    return next;
  };


  return (
    <>
      {dialog}
    <div className="overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-soft">
      <div
        className="grid border-b border-border-soft bg-surface-muted"
        style={{ gridTemplateColumns: `3.25rem repeat(${days}, minmax(0,1fr))` }}
      >
        <div />
        {columns.map((day) => (
          <div key={day.toISOString()} className="py-2 text-center">
            <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              {format(day, "EEE")}
            </p>
            <p
              className={cn(
                "mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold",
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
        className="grid border-b border-border-soft"
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
              {/* Background commitments (school, work): deliberately lighter than timed events */}
              {allDay.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  {...dragProps(o)}
                  onClick={() => openOccurrence(o)}
                  className={cn(
                    "flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10px] font-semibold opacity-80 transition-opacity hover:opacity-100",
                    draggingKey === o.key && "opacity-40",
                    eventTintClass(categoryAppearanceFor(o.event.category_id)),
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.event.title}</span>
                  <MemberBadgeRow ids={o.member_ids} size="xs" />
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
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
          </div>

          {columns.map((day) => {
            const dayOccurrences = occurrences.filter((o) => isSameDay(o.start, day));
            const coverage = dayOccurrences.filter((o) => isCareLayer(o));
            const visible = dayOccurrences.filter(
              (o) =>
                !isCareLayer(o) &&
                !isDayBlock(o) &&
                occurrenceMatchesFilter(o, selectedMembers),
            );

            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-border-soft"
                style={{ height: hours.length * HOUR_PX }}
                {...dropProps((e) => startFromDrop(day, e))}
              >
                {hours.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_PX }}
                    className="border-b border-border-soft/60"
                  />
                ))}

                {/* Babysitter coverage: warm neutral shading across the whole scheduled range,
                    never a family colour and never an event card. Sits behind everything. */}
                {coverage.map((o) =>
                  isChildcare(o.event) ? (
                    <button
                      key={o.key}
                      type="button"
                      {...dragProps(o)}
                      onClick={() => openOccurrence(o)}
                      aria-label={`${careLabel(o)} ${formatTimeRange(o.start, o.end, false)}`}
                      className={cn(
                        "absolute inset-x-0 block w-full border-y border-coverage-strong/40 bg-coverage/45 text-left align-top",
                        draggingKey === o.key && "opacity-40",
                      )}
                      style={{ top: topFor(o.start), height: heightFor(o) }}
                    >
                      <span className="block truncate px-1.5 pt-0.5 text-[9px] leading-tight font-semibold text-coverage-foreground">
                        {careLabel(o)} · {compactRange(o.start, o.end)}
                      </span>
                    </button>
                  ) : (
                    <div
                      key={o.key}
                      aria-label={`${careLabel(o)} ${formatTimeRange(o.start, o.end, false)}`}
                      className="pointer-events-none absolute inset-x-0 bg-coverage/60"
                      style={{ top: topFor(o.start), height: heightFor(o) }}
                    >
                      <span className="block truncate px-1.5 pt-0.5 text-[9px] leading-tight font-semibold text-coverage-foreground">
                        {careLabel(o)} · {compactRange(o.start, o.end)}
                      </span>
                    </div>
                  ),
                )}

                {/* Timed events carry the strongest emphasis and sit above the coverage layer,
                    in side-by-side lanes when they overlap. The left gutter keeps shading visible. */}
                <div className="absolute inset-y-0 right-1 left-3 sm:left-4">
                  {withLanes(visible).map(({ occurrence: o, lane, laneCount }) => {
                    const Icon = eventTypeIcons[o.event.event_type];
                    const compact = heightFor(o) < 44;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        {...dragProps(o)}
                        onClick={() => openOccurrence(o)}
                        className={cn(
                          "absolute overflow-hidden rounded-xl border border-border-soft px-1.5 py-1 text-left shadow-soft transition-transform hover:-translate-y-px",
                          eventTintClass(categoryAppearanceFor(o.event.category_id)),
                          draggingKey === o.key && "opacity-40",
                        )}
                        style={{
                          top: topFor(o.start),
                          height: heightFor(o),
                          left: `calc(${(lane / laneCount) * 100}% + 1px)`,
                          width: `calc(${100 / laneCount}% - 2px)`,
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-bold">
                            {o.event.title}
                          </span>
                        </div>
                        {compact ? (
                          <MemberBadgeRow ids={o.member_ids} size="xs" className="mt-0.5" />
                        ) : (
                          <>
                            <MemberBadgeRow ids={o.member_ids} size="xs" className="mt-0.5" />
                            <p className="mt-0.5 truncate text-[9px] font-semibold text-muted-foreground">
                              {formatTimeRange(o.start, o.end, false)}
                            </p>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}
