import {
  Baby,
  Briefcase,
  CalendarHeart,
  GraduationCap,
  MapPin,
  Stethoscope,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MemberBadgeRow } from "@/components/MemberBadge";
import {
  formatTimeRange,
  memberStyles,
  type EventType,
  type Occurrence,
} from "@/lib/family-data";

export const eventTypeIcons: Record<EventType, LucideIcon> = {
  school: GraduationCap,
  activity: Trophy,
  work: Briefcase,
  childcare: Baby,
  appointment: Stethoscope,
  family: CalendarHeart,
  other: Sparkles,
};

/** The soft tint comes from the first assigned family member — members are the primary identity. */
function tintFor(occurrence: Occurrence) {
  const first = occurrence.event.member_ids[0];
  return first ? memberStyles[first].soft : "bg-surface-muted";
}

function accentFor(occurrence: Occurrence) {
  const first = occurrence.event.member_ids[0];
  return first ? memberStyles[first].dot : "bg-border";
}

export function EventPill({ occurrence }: { occurrence: Occurrence }) {
  const { event } = occurrence;
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg px-1.5 py-1 text-left text-[11px] leading-tight",
        tintFor(occurrence),
      )}
    >
      <span className="min-w-0 flex-1 truncate font-semibold">{event.title}</span>
      <MemberBadgeRow ids={event.member_ids} size="xs" />
    </div>
  );
}

export function EventCard({
  occurrence,
  showDate,
  className,
}: {
  occurrence: Occurrence;
  showDate?: string;
  className?: string;
}) {
  const { event, start, end } = occurrence;
  const Icon = eventTypeIcons[event.event_type];

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border-soft bg-card p-3 shadow-soft",
        className,
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", accentFor(occurrence))} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pl-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <h3 className="truncate text-sm font-bold">{event.title}</h3>
          </div>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {showDate ? `${showDate} · ` : ""}
            {formatTimeRange(start, end, event.all_day)}
          </p>
          {event.location ? (
            <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              {event.location}
            </p>
          ) : null}
        </div>
        <MemberBadgeRow ids={event.member_ids} size="sm" className="pt-0.5" />
      </div>
    </article>
  );
}
