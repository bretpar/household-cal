import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import {
  CALENDAR_COLORS,
  CALENDAR_ICON_KEYS,
  CALENDAR_ICON_LABELS,
  CALENDAR_ICON_NONE,
  defaultCalendarColor,
} from "@/lib/calendar-appearance";
import { calendarIconComponent } from "@/lib/calendar-icons";
import { styleForColor, type CalendarSource, type DisplayMode, type MemberColor } from "@/lib/family-data";
import { setCalendarAppearance, setCalendarDisplayMode } from "@/lib/google.functions";
import {
  updateIcsSubscriptionAppearance,
  updateIcsSubscriptionDisplayMode,
} from "@/lib/ics.functions";
import { cn } from "@/lib/utils";

/**
 * Persistent presentation choices only; calendar visibility stays in Calendar
 * filters and nothing here is written back to Google or Apple.
 */
export function CalendarAppearanceSettings() {
  const queryClient = useQueryClient();
  const { sources, canEdit, isOwner } = useCalendar();
  const updateCalendarMode = useServerFn(setCalendarDisplayMode);
  const updateAppleMode = useServerFn(updateIcsSubscriptionDisplayMode);
  const updateCalendarLook = useServerFn(setCalendarAppearance);
  const updateAppleLook = useServerFn(updateIcsSubscriptionAppearance);

  const appearanceSources = sources.filter(
    (source) =>
      source.active &&
      (source.provider === "google" ||
        source.provider === "ics" ||
        source.display_mode === "coverage_background"),
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    await queryClient.invalidateQueries({ queryKey: ["calendar-sync"] });
    await queryClient.invalidateQueries({ queryKey: ["apple-subscriptions"] });
  };

  const mutation = useMutation({
    mutationFn: async ({ source, displayMode }: { source: CalendarSource; displayMode: DisplayMode }) => {
      if (source.provider === "ics") {
        return updateAppleMode({ data: { id: source.id, display_mode: displayMode } });
      }
      return updateCalendarMode({
        data: { source_id: source.id, display_mode: displayMode },
      });
    },
    onSuccess: async () => {
      toast.success("Calendar appearance updated");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lookMutation = useMutation({
    mutationFn: async ({
      source,
      color,
      icon,
    }: {
      source: CalendarSource;
      color: MemberColor;
      icon: string | null;
    }) => {
      if (source.provider === "ics") {
        return updateAppleLook({ data: { id: source.id, color, icon } });
      }
      return updateCalendarLook({ data: { source_id: source.id, color, icon } });
    },
    onSuccess: async () => {
      toast.success("Calendar appearance updated");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (appearanceSources.length === 0) return null;

  const busy = mutation.isPending || lookMutation.isPending;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
        Calendar appearance
      </h3>
      <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
        {appearanceSources.map((source, index) => {
          const editable = source.provider === "ics" ? canEdit : isOwner;
          const color = (source.color ?? defaultCalendarColor(index)) as MemberColor;
          const iconValue = source.display_icon ?? CALENDAR_ICON_NONE;
          const SelectedIcon = calendarIconComponent(source.display_icon);
          const isLocal = source.provider === "local";
          const background = source.display_mode === "coverage_background";
          const previewTint = background
            ? MUTED_CALENDAR_TINT[color]
            : styleForColor(color).soft;
          return (
            <div key={source.id} className="space-y-2 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn("h-6 w-6 shrink-0 rounded-lg", styleForColor(color).dot)}
                  aria-hidden
                />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
                  {source.name}
                </p>
                <Select
                  value={source.display_mode}
                  disabled={!editable || busy}
                  onValueChange={(displayMode: DisplayMode) =>
                    mutation.mutate({ source, displayMode })
                  }
                >
                  <SelectTrigger
                    className="h-9 w-40 rounded-lg text-xs"
                    aria-label={`Display style for ${source.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="events">Events (front)</SelectItem>
                    <SelectItem value="coverage_background">Background layer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pl-8">
                <span
                  className={cn(
                    "flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold",
                    previewTint,
                    background && "text-muted-foreground",
                  )}
                >
                  {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  <span className="truncate">{source.name}</span>
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {background
                    ? "Sits softly behind family events"
                    : "Shows as a normal event card"}
                </span>
              </div>


              {isLocal ? null : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-8">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {CALENDAR_COLORS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={!editable || busy}
                        aria-label={`Use the ${option} color for ${source.name}`}
                        aria-pressed={color === option}
                        onClick={() =>
                          lookMutation.mutate({
                            source,
                            color: option,
                            icon: source.display_icon ?? null,
                          })
                        }
                        className={cn(
                          "h-6 w-6 rounded-full ring-offset-2 transition disabled:opacity-50",
                          styleForColor(option).dot,
                          color === option ? "ring-2 ring-ring" : "",
                        )}
                      />
                    ))}
                  </div>
                  <Select
                    value={iconValue}
                    disabled={!editable || busy}
                    onValueChange={(next) =>
                      lookMutation.mutate({
                        source,
                        color,
                        icon: next === CALENDAR_ICON_NONE ? null : next,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-36 rounded-lg text-xs"
                      aria-label={`Icon for ${source.name}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5" aria-hidden /> : null}
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CALENDAR_ICON_NONE}>No icon</SelectItem>
                      {CALENDAR_ICON_KEYS.map((key) => {
                        const Icon = calendarIconComponent(key);
                        return (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2">
                              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
                              {CALENDAR_ICON_LABELS[key]}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Pick a colour and an optional icon for each calendar. Background calendars use a softer
        version of the same colour. Visibility is controlled from Calendar filters.
      </p>
    </section>
  );
}
