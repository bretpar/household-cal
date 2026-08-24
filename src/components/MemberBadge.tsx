import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import { isEveryoneAssigned } from "@/lib/event-colors";
import type { MemberId } from "@/lib/family-data";

const sizes = {
  xs: "h-4 w-4 text-[9px]",
  sm: "h-5 w-5 text-[10px]",
  md: "h-7 w-7 text-xs",
  lg: "h-11 w-11 text-base",
};

export function MemberBadge({
  id,
  size = "sm",
  className,
}: {
  id: MemberId;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const { memberById, styleFor } = useCalendar();
  const member = memberById[id];
  return (
    <span
      title={member?.name ?? ""}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        styleFor(id).badge,
        sizes[size],
        className,
      )}
    >
      {member?.initial ?? "?"}
    </span>
  );
}

export function MemberBadgeRow({
  ids,
  size = "xs",
  className,
}: {
  ids: MemberId[];
  size?: keyof typeof sizes;
  className?: string;
}) {
  const { members } = useCalendar();
  if (ids.length === 0) return null;
  if (isEveryoneAssigned(ids, members.length)) {
    return (
      <span
        title="Everyone"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-shared-strong px-1.5 font-bold text-member-foreground",
          sizes[size],
          "w-auto",
          className,
        )}
      >
        All
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {ids.map((id) => (
        <MemberBadge key={id} id={id} size={size} />
      ))}
    </span>
  );
}
