import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";

export function MemberFilter({ className }: { className?: string }) {
  const { selectedMembers, toggleMember, clearMembers, members, styleFor } = useCalendar();
  const visible = members.filter((m) => m.active);
  const all = selectedMembers.length === 0;

  if (visible.length === 0) return null;

  const shown = all ? visible : visible.filter((m) => selectedMembers.includes(m.id));
  const hidden = all ? [] : visible.filter((m) => !selectedMembers.includes(m.id));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={clearMembers}
          aria-pressed={all}
          className={cn(
            "h-10 rounded-full px-4 text-sm font-semibold transition-colors",
            all
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-muted-foreground border border-border hover:bg-secondary",
          )}
        >
          Everyone
        </button>
        {visible.map((member) => {
          const on = all || selectedMembers.includes(member.id);
          const style = styleFor(member.id);
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => toggleMember(member.id)}
              aria-pressed={on}
              title={on ? `${member.name} — shown. Tap to hide.` : `${member.name} — hidden. Tap to show.`}
              className={cn(
                "relative flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition-all",
                on
                  ? cn("w-10", style.badge, !all && cn("ring-2 ring-offset-2 ring-offset-background", style.ring))
                  : "w-10 border border-dashed border-border bg-surface text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              {member.initial}
              {!on && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted border border-border">
                  <EyeOff className="h-2.5 w-2.5 text-muted-foreground" aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {all ? (
          <>Showing everyone ({visible.length})</>
        ) : (
          <>
            Showing {shown.map((m) => m.name).join(", ") || "no one"}
            {hidden.length > 0 && <> · Hidden: {hidden.map((m) => m.name).join(", ")}</>}
          </>
        )}
      </p>
    </div>
  );
}
