import { Button } from "@/components/ui/button";
import { useCalendar } from "@/lib/calendar-store";
import { useWeekStart } from "@/lib/week-start-preference";
import { cn } from "@/lib/utils";

/** Whether calendar weeks begin on Monday or Sunday for this user. */
export function WeekStartSetting() {
  const { family } = useCalendar();
  const { weekStart, ready, setWeekStart } = useWeekStart(family?.id ?? null);

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-bold">Start week on</p>
        <p className="text-xs text-muted-foreground">
          Saved to your account and used on every device.
        </p>
      </div>
      <div className="flex rounded-full bg-surface-muted p-1" role="group" aria-label="Start week on">
        {([
          { value: 0 as const, label: "Sunday" },
          { value: 1 as const, label: "Monday" },
        ]).map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready}
            aria-pressed={weekStart === option.value}
            onClick={() => setWeekStart(option.value)}
            className={cn(
              "h-9 min-w-20 rounded-full px-4 text-sm font-semibold hover:bg-surface",
              weekStart === option.value && "bg-surface text-foreground shadow-soft hover:bg-surface",
            )}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
