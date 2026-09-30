import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format, isSameDay, startOfDay } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewCaregiverAccess } from "@/lib/caregiver-preview.functions";
import { expandOccurrences } from "@/lib/family-data";

const DAYS = 28;

/** Owner-only, read-only look at what a caregiver sees over the next four weeks. */
export function CaregiverPreviewDialog({
  membershipId,
  name,
  onClose,
}: {
  membershipId: string | null;
  name: string;
  onClose: () => void;
}) {
  const fetchPreview = useServerFn(previewCaregiverAccess);
  const q = useQuery({
    queryKey: ["caregiver-preview", membershipId],
    enabled: !!membershipId,
    staleTime: 0,
    queryFn: () => fetchPreview({ data: { membership_id: membershipId! } }),
  });

  const start = startOfDay(new Date());
  const end = addDays(start, DAYS);
  const occurrences = q.data
    ? expandOccurrences(q.data.events, start, end).sort((a, b) => a.start.getTime() - b.start.getTime())
    : [];
  const days: Date[] = [];
  for (let i = 0; i < DAYS; i++) days.push(addDays(start, i));
  const visibleDays = days
    .map((d) => ({ day: d, items: occurrences.filter((o) => isSameDay(o.start, d)) }))
    .filter((d) => d.items.length > 0);

  return (
    <Dialog open={!!membershipId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What {name} can see</DialogTitle>
          <DialogDescription>
            Preview of the next 4 weeks with her current access. Nothing is changed.
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {q.error instanceof Error ? q.error.message : "Could not load the preview."}
          </p>
        ) : q.data ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-surface-muted p-3 text-sm">
              <p>
                <span className="font-bold">Days: </span>
                {q.data.date_scope === "shift_days_only" ? "Only her shift days" : "All days"}
              </p>
              <p>
                <span className="font-bold">Calendars: </span>
                {q.data.calendars.length ? q.data.calendars.join(", ") : "None"}
              </p>
            </div>
            {visibleDays.length === 0 ? (
              <p className="text-sm text-muted-foreground">She has nothing to see in the next 4 weeks.</p>
            ) : (
              visibleDays.map(({ day, items }) => (
                <section key={day.toISOString()} className="space-y-1.5">
                  <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    {format(day, "EEEE, MMM d")}
                  </h3>
                  {items.map((o) => (
                    <div
                      key={o.key}
                      className="flex items-baseline justify-between gap-3 rounded-2xl border border-border-soft bg-card px-3 py-2"
                    >
                      <span className="min-w-0 truncate font-semibold">
                        {o.event.title}
                        {o.event.is_my_shift ? (
                          <span className="ml-2 text-xs font-bold text-primary">Her shift</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {o.event.all_day ? "All day" : format(o.start, "h:mm a")}
                      </span>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
