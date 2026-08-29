import type { LucideIcon } from "lucide-react";

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
  className?: string;
}) {
  const scale = EVENT_TYPE_SCALE[view];
  const label = title ?? occurrence.event.title;
  const time = formatTimeRange(occurrence.start, occurrence.end, occurrence.event.all_day);
  const timeTone = eventTimeToneClass(muted);
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
  // the event happens. Month pills keep the time (no timeline to read it from).
  if (density === "tiny" || density === "short") {
    const showTime = view === "month" || (view === "day" && density === "short");
    return (
      <div className={cn(wrapperClass, "flex items-center gap-1.5")}>
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className={cn("min-w-0 flex-1 truncate", scale.title)}>{label}</span>
          {showTime ? (
            <span className={cn("shrink-0 truncate", scale.time, timeTone)}>{time}</span>
          ) : null}
        </button>
        {badges}
      </div>
    );
  }


  // Medium: title + time, no icon/metadata decoration.
  if (density === "medium") {
    return (
      <div className={cn(wrapperClass, "flex items-start gap-1.5")}>
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className="block min-w-0 flex-1 text-left"
        >
          <span className={cn("block truncate", scale.title)}>{label}</span>
          <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
        </button>
        {badges}
      </div>
    );
  }

  // Full: icon + title, time, badges on their own row.
  return (
    <div className={wrapperClass}>
      <button type="button" onClick={onOpen} disabled={!onOpen} className="block w-full text-left">
        <span className="flex items-center gap-1.5">
          {Icon ? <Icon className={cn("shrink-0", scale.icon, timeTone)} aria-hidden /> : null}
          <span className={cn("min-w-0 flex-1 truncate", scale.title)}>{label}</span>
        </span>
        <span className={cn("mt-0.5 block truncate", scale.time, timeTone)}>{time}</span>
      </button>
      <div className="mt-1">{badges}</div>
    </div>
  );
}
