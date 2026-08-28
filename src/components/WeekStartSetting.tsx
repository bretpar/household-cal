import { Switch } from "@/components/ui/switch";
import { useCalendar } from "@/lib/calendar-store";
import { useWeekStart } from "@/lib/week-start-preference";

/** Whether calendar weeks begin on Monday or Sunday for this user. */
export function WeekStartSetting() {
  const { family } = useCalendar();
  const { weekStart, ready, setWeekStart } = useWeekStart(family?.id ?? null);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold">Week starts on Monday</p>
        <p className="text-xs text-muted-foreground">
          Choose whether calendar weeks begin on Monday or Sunday.
        </p>
      </div>
      <Switch
        checked={weekStart === 1}
        disabled={!ready}
        onCheckedChange={(checked) => setWeekStart(checked ? 1 : 0)}
        aria-label="Week starts on Monday"
      />
    </div>
  );
}
