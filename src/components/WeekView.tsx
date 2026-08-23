import { addDays, format, isSameDay, startOfWeek } from "date-fns";

import { cn } from "@/lib/utils";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { eventTypeIcons } from "@/components/EventCard";
import {
  expandOccurrences,
  formatTimeRange,
  isCoverage,
  matchesFilter,
  memberStyles,
  type CalendarEvent,
  type MemberId,
  type Occurrence,
} from "@/lib/family-data";

const DAY_START = 7;
const DAY_END = 22;
const HOUR_PX = 60;

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
  const start = days === 1 ? anchor : startOfWeek(anchor, { weekStartsOn: 1 });
  const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occurrences = expandOccurrences(events, columns[0]!, addDays(columns[days - 1]!, 1));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  return (
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
              !isCoverage(o.event) &&
              isSameDay(o.start, day) &&
              matchesFilter(o.event, selectedMembers),
          );
          return (
            <div
              key={day.toISOString()}
              className="min-h-7 space-y-0.5 border-l border-border-soft p-1"
            >
              {/* Background commitments (school, work): deliberately lighter than timed events */}
              {allDay.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => openOccurrence(o)}
                  className={cn(
                    "flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10px] font-semibold opacity-80 transition-opacity hover:opacity-100",
                    o.event.member_ids[0]
                      ? memberStyles[o.event.member_ids[0]].soft
                      : "bg-surface-muted",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.event.title}</span>
                  <MemberBadgeRow ids={o.event.member_ids} size="xs" />
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
            const coverage = dayOccurrences.filter((o) => isCoverage(o.event));
            const visible = dayOccurrences.filter(
              (o) =>
                !isCoverage(o.event) &&
                !isDayBlock(o) &&
                matchesFilter(o.event, selectedMembers),
            );

            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-border-soft"
                style={{ height: hours.length * HOUR_PX }}
              >
                {hours.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_PX }}
                    className="border-b border-border-soft/60"
                  />
                ))}

                {/* Babysitter coverage: background time-range layer, behind events */}
                {coverage.map((o) => (
                  <div
                    key={o.key}
                    className="absolute inset-x-0.5 rounded-xl bg-coverage-strong/70"
                    style={{ top: topFor(o.start), height: heightFor(o) }}
                  >
                    <span className="block px-1.5 pt-1 text-[9px] leading-tight font-bold text-coverage-foreground">
                      Babysitter {formatTimeRange(o.start, o.end, false)}
                    </span>
                  </div>
                ))}

                {/* Events sit above the coverage layer, in side-by-side lanes when they overlap.
                    The left gutter keeps coverage shading visible behind them. */}
                <div className="absolute inset-y-0 right-1 left-4">
                  {withLanes(visible).map(({ occurrence: o, lane, laneCount }) => {
                    const Icon = eventTypeIcons[o.event.event_type];
                    const first = o.event.member_ids[0];
                    return (
                      <div
                        key={o.key}
                        className={cn(
                          "absolute overflow-hidden rounded-xl border border-border-soft/70 px-1.5 py-1 shadow-soft",
                          first ? memberStyles[first].soft : "bg-surface-muted",
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
                        <MemberBadgeRow ids={o.event.member_ids} size="xs" className="mt-0.5" />
                        <p className="mt-0.5 truncate text-[9px] font-semibold text-muted-foreground">
                          {formatTimeRange(o.start, o.end, false)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
