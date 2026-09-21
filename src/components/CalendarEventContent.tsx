import { cn } from "@/lib/utils";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { formatCompactTimeRange, type Occurrence } from "@/lib/family-data";
import { eventTimeToneClass } from "@/lib/event-typography";
import {
  EVENT_TEXT_SCALE,
  planEventContent,
  type EventContentPlan,
} from "@/lib/calendar-layout";

/**
 * The only content renderer for timeline event cards (Day, 3-Day, Week — every
 * device, orientation and size) and for the background coverage label.
 *
 * Content priority is fixed: title, then compact time, then member badges. What
 * is shown comes from the card's rendered width/height via `planEventContent`,
 * never from the device or the view. Recurrence is intentionally not shown here
 * — it lives in the event details modal.
 */
export function CalendarEventContent({
  occurrence,
  width,
  height,
  muted = false,
  title,
  plan: planOverride,
  forceTime = false,
  className,
}: {
  occurrence: Occurrence;
  /** Rendered card width in px. */
  width: number;
  /** Rendered card height in px. */
  height: number;
  /** Background/secondary source: same rules, muted colour only. */
  muted?: boolean;
  /** Override the label (coverage blocks show their calendar name). */
  title?: string;
  plan?: EventContentPlan | undefined;
  /** Coverage labels always state their range so the end time is never hidden. */
  forceTime?: boolean;
  className?: string;
}) {
  const label = title ?? occurrence.event.title;
  const time = formatCompactTimeRange(
    occurrence.start,
    occurrence.end,
    occurrence.event.all_day,
  );
  const badgeCount = occurrence.member_ids.length;
  const plan =
    planOverride ?? planEventContent({ width, height, badgeCount });
  const scale = EVENT_TEXT_SCALE[plan.scale];
  const timeTone = eventTimeToneClass(muted);
  const showTime = plan.showTime || forceTime;


  return (
    <div className={cn("flex h-full min-w-0 flex-col gap-px", plan.padding, className)}>
      <span className={cn("min-w-0 line-clamp-2 text-left", scale.title)}>{label}</span>
      {showTime || plan.showBadges ? (
        <div className="flex min-w-0 items-center gap-1">
          {showTime ? (
            <span className={cn("min-w-0 flex-1 truncate text-left", scale.time, timeTone)}>
              {time}
            </span>
          ) : null}
          {plan.showBadges ? (
          <MemberBadgeRow
            ids={occurrence.member_ids}
            size={scale.badge}
            maxVisible={plan.maxBadges}
            className="pointer-events-none shrink-0"
          />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
