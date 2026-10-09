import { ChevronDown, EyeOff, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";

/** Compact "Filter ▾" button that opens the people filter in a popover. */
export function PeopleFilterButton({ className }: { className?: string }) {
  const { selectedMembers, memberById } = useCalendar();
  const count = selectedMembers.length;
  const label =
    count === 0 ? "Filter" : count === 1 ? (memberById[selectedMembers[0]!]?.name ?? "Filter (1)") : `Filter (${count})`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tour-target="people-filter"
          aria-label={count ? `People filter — ${count} active` : "People filter"}
          className={cn(
            "flex h-11 min-w-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
            count
              ? "border-primary bg-secondary text-foreground"
              : "border-border-soft bg-surface text-muted-foreground hover:bg-secondary",
            className,
          )}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] rounded-2xl p-3" onInteractOutside={(event) => {
        if (event.target instanceof Element && event.target.closest(".app-tour-tooltip")) event.preventDefault();
      }}>
        <MemberFilter excludeCaregivers hideSummary />
      </PopoverContent>
    </Popover>
  );
}

export function MemberFilter({
  className,
  excludeCaregivers = false,
  hideSummary = false,
}: {
  className?: string;
  excludeCaregivers?: boolean;
  hideSummary?: boolean;
}) {
  const { selectedMembers, toggleMember, clearMembers, members, styleFor } = useCalendar();
  const visible = members.filter(
    (m) => m.active && !(excludeCaregivers && m.role === "caregiver"),
  );
  const all = selectedMembers.length === 0;

  if (visible.length === 0) return null;

  const shown = all ? visible : visible.filter((m) => selectedMembers.includes(m.id));
  const hidden = all ? [] : visible.filter((m) => !selectedMembers.includes(m.id));

  return (
    <div data-tour-target="people" className={cn("flex flex-col gap-1.5", className)}>
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
      <p className={cn("text-xs text-muted-foreground", hideSummary && "sr-only")} aria-live="polite">
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
