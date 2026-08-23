import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";

export function MemberFilter({ className }: { className?: string }) {
  const { selectedMembers, toggleMember, clearMembers, members, styleFor } = useCalendar();
  const all = selectedMembers.length === 0;
  const visible = members.filter((m) => m.active);

  if (visible.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        onClick={clearMembers}
        aria-pressed={all}
        className={cn(
          "h-10 rounded-full px-4 text-sm font-semibold transition-colors",
          all
            ? "bg-primary text-primary-foreground"
            : "bg-surface text-muted-foreground border border-border-soft hover:bg-secondary",
        )}
      >
        All
      </button>
      {visible.map((member) => {
        const on = selectedMembers.includes(member.id);
        const style = styleFor(member.id);
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => toggleMember(member.id)}
            aria-pressed={on}
            aria-label={`Filter by ${member.name}`}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all",
              style.badge,
              on
                ? cn("ring-2 ring-offset-2 ring-offset-background", style.ring)
                : "opacity-55 hover:opacity-90",
            )}
          >
            {member.initial}
          </button>
        );
      })}
    </div>
  );
}
