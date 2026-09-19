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
import type { CalendarSource, DisplayMode } from "@/lib/family-data";
import { setCalendarDisplayMode } from "@/lib/google.functions";
import { updateIcsSubscriptionDisplayMode } from "@/lib/ics.functions";

/** Persistent presentation choices only; calendar visibility stays in Calendar filters. */
export function CalendarAppearanceSettings() {
  const queryClient = useQueryClient();
  const { sources, canEdit, isOwner } = useCalendar();
  const updateCalendarMode = useServerFn(setCalendarDisplayMode);
  const updateAppleMode = useServerFn(updateIcsSubscriptionDisplayMode);

  const appearanceSources = sources.filter(
    (source) =>
      source.active &&
      (source.provider === "google" ||
        source.provider === "ics" ||
        source.display_mode === "coverage_background"),
  );

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
      await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      await queryClient.invalidateQueries({ queryKey: ["calendar-sync"] });
      await queryClient.invalidateQueries({ queryKey: ["apple-subscriptions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (appearanceSources.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
        Calendar appearance
      </h3>
      <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
        {appearanceSources.map((source) => {
          const editable = source.provider === "ics" ? canEdit : isOwner;
          return (
            <div
              key={source.id}
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
            >
              <p className="min-w-0 text-sm font-semibold leading-snug">{source.name}</p>
              <Select
                value={source.display_mode}
                disabled={!editable || mutation.isPending}
                onValueChange={(displayMode: DisplayMode) =>
                  mutation.mutate({ source, displayMode })
                }
              >
                <SelectTrigger
                  className="h-9 w-32 rounded-lg text-xs"
                  aria-label={`Appearance for ${source.name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="events">Events</SelectItem>
                  <SelectItem value="coverage_background">Background</SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Choose how these calendars appear. Visibility is controlled from Calendar filters.
      </p>
    </section>
  );
}