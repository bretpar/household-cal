import type { LucideIcon } from "lucide-react";
import { Repeat2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { formatTimeRange, type Occurrence } from "@/lib/family-data";
import {
  EVENT_TYPE_SCALE,
  eventTimeToneClass,
  type CalendarViewScale,
  type EventDensity,
} from "@/lib/event-typography";

/**
 * Shared event content used by Month, Week and Day so no view keeps its own
 * font rules. Typography is fixed per view; `density` only changes which rows
 * are rendered and how tight the padding is.
 */
export function CalendarEventContent({
  occurrence,
  view,
  density,
  /** background/secondary source: same type scale, muted colour only */
  muted = false,
  icon: Icon,
  title,
  onOpen,
  showRecurrence = false,
  className,
}: {
  occurrence: Occurrence;
  view: CalendarViewScale;
  density: EventDensity;
  muted?: boolean;
  icon?: LucideIcon | undefined;
  /** override the label (coverage blocks show their calendar name) */
  title?: string;
  onOpen?: (() => void) | undefined;
  /** Show a quiet scan marker on timed cards without changing their interaction. */
  showRecurrence?: boolean;
  className?: string;
}) {
  const scale = EVENT_TYPE_SCALE[view];
  const label = title ?? occurrence.event.title;
  const time = formatTimeRange(occurrence.start, occurrence.end, occurrence.event.all_day);
  const timeTone = eventTimeToneClass(muted);
  const recurrenceIndicator =
    showRecurrence && occurrence.event.recurrence_rule ? (
      <span className="inline-flex shrink-0 text-muted-foreground" title="Repeating event">
        <Repeat2 className="h-3 w-3" aria-hidden />
        <span className="sr-only">Repeating event</span>
      </span>
    ) : null;
  const badges = (
    <MemberBadgeRow
      ids={occurrence.member_ids}
      size={scale.badge}
      className="pointer-events-none shrink-0"
    />
  );

  const wrapperClass = cn("h-full min-w-0", scale.padding[density], className);

  // Compact rows: the title always wins. The written time is dropped before the
  // title is truncated, because the block's vertical position already says when
  // the event happens. Month pills keep the time inline (no timeline to read
  // it from); Day/3-Day/Week short blocks show time stacked below the title.
  if (density === "tiny" || density === "short") {
    const showInlineTime = view === "month" && density === "short";
    const showStackedTime = density === "short" && view !== "month" && !occurrence.event.all_day;
    const innerLayout = showStackedTime ? "block" : "flex items-center gap-1.5";
    const titleRow = (
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn("block min-w-0 flex-1 line-clamp-1", scale.title)}>{label}</span>
        {recurrenceIndicator}
      </span>
    );
    return (
      <div
        className={cn(
          wrapperClass,
          showStackedTime ? "flex items-start gap-1.5" : "flex items-center gap-1.5",
        )}
      >
        {onOpen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className={cn("min-w-11 flex-1 text-left", innerLayout)}
          >
            {titleRow}
            {showInlineTime ? (
              <span className={cn("shrink-0 truncate", scale.time, timeTone)}>{time}</span>
            ) : showStackedTime ? (
              <span className={cn("block truncate leading-none", scale.time, timeTone)}>
                {time}
              </span>
            ) : null}
          </button>
        ) : (
          <div className={cn("min-w-0 flex-1 text-left", innerLayout)}>
            {titleRow}
            {showInlineTime ? (
              <span className={cn("shrink-0 truncate", scale.time, timeTone)}>{time}</span>
            ) : showStackedTime ? (
              <span className={cn("block truncate leading-none", scale.time, timeTone)}>
                {time}
              </span>
            ) : null}
          </div>
        )}
        {badges}
      </div>
    );
  }

  // Medium: title + time, no icon/metadata decoration.
  if (density === "medium") {
    return (
      <div className={cn(wrapperClass, "flex items-start gap-1.5")}>
        {onOpen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="block min-w-11 flex-1 text-left"
          >
            <span className="flex min-w-0 items-center gap-1">
              <span className={cn("block min-w-0 flex-1 line-clamp-1", scale.title)}>{label}</span>
              {recurrenceIndicator}
            </span>
            <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
          </button>
        ) : (
          <div className="block min-w-0 flex-1 text-left">
            <span className="flex min-w-0 items-center gap-1">
              <span className={cn("block min-w-0 flex-1 line-clamp-1", scale.title)}>{label}</span>
              {recurrenceIndicator}
            </span>
            <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
          </div>
        )}
        {badges}
      </div>
    );
  }

  // Full: icon + title, time, badges on their own row.
  return (
    <div className={wrapperClass}>
      {onOpen ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="block w-full text-left"
        >
          <span className="flex items-center gap-1.5">
            {Icon ? <Icon className={cn("shrink-0", scale.icon, timeTone)} aria-hidden /> : null}
            <span className={cn("min-w-0 flex-1 line-clamp-1", scale.title)}>{label}</span>
            {recurrenceIndicator}
          </span>
          <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
        </button>
      ) : (
        <div className="w-full text-left">
          <span className="flex items-center gap-1.5">
            {Icon ? <Icon className={cn("shrink-0", scale.icon, timeTone)} aria-hidden /> : null}
            <span className={cn("min-w-0 flex-1 line-clamp-1", scale.title)}>{label}</span>
            {recurrenceIndicator}
          </span>
          <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
        </div>
      )}
      <div className="mt-1">{badges}</div>
    </div>
  );
}
