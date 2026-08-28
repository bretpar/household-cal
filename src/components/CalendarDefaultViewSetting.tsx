import { useCalendar } from "@/lib/calendar-store";
import {
  CALENDAR_VIEW_LABEL,
  useDefaultCalendarView,
  type CalendarViewMode,
} from "@/lib/calendar-view-preference";
import { cn } from "@/lib/utils";

/** Which view the Calendar page opens on for this user. */
export function CalendarDefaultViewSetting() {
  const { family } = useCalendar();
  const { defaultView, ready, setDefaultView } = useDefaultCalendarView(family?.id ?? null);
  const current: CalendarViewMode = defaultView ?? "month";

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-bold">Calendar default view</p>
        <p className="text-xs text-muted-foreground">
          The Calendar page opens on this view, on every device.
        </p>
      </div>
      <div className="flex rounded-full bg-surface-muted p-1" role="group" aria-label="Calendar default view">
        {(["day", "week", "month"] as CalendarViewMode[]).map((value) => (
          <button
            key={value}
            type="button"
            disabled={!ready}
            aria-pressed={current === value}
            onClick={() => setDefaultView(value)}
            className={cn(
              "h-9 rounded-full px-4 text-sm font-semibold transition-colors",
              current === value ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground",
            )}
          >
            {CALENDAR_VIEW_LABEL[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
