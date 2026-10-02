import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getShiftSettings, updateShiftSettings } from "@/lib/babysitter-shifts.functions";
import { useCalendar } from "@/lib/calendar-store";
import { isWritableDestination } from "@/lib/family-data";

const NONE = "__none__";

/** Owner-only: which calendar holds babysitting shifts and who the default babysitter is. */
export function BabysitterShiftSettings() {
  const { isOwner, sources } = useCalendar();
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getShiftSettings);
  const save = useServerFn(updateShiftSettings);
  const settings = useQuery({
    queryKey: ["shift-settings"],
    queryFn: () => fetchSettings(),
    enabled: isOwner,
  }).data;
  const mutation = useMutation({
    mutationFn: (next: { calendar_source_id: string | null; default_member_id: string | null }) =>
      save({ data: next }),
    onSuccess: () => {
      toast.success("Babysitter settings saved");
      void qc.invalidateQueries({ queryKey: ["shift-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  if (!isOwner || !settings) return null;
  const calendars = sources.filter(isWritableDestination);
  const current = {
    calendar_source_id: settings.calendar_source_id,
    default_member_id: settings.default_member_id,
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
        Babysitting shifts
      </h3>
      <div className="space-y-1">
        <Label>Babysitter calendar</Label>
        <Select
          value={settings.calendar_source_id ?? NONE}
          disabled={mutation.isPending}
          onValueChange={(v) =>
            mutation.mutate({ ...current, calendar_source_id: v === NONE ? null : v })
          }
        >
          <SelectTrigger className="h-10 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {calendars.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Timed events on this calendar become babysitting shifts.
        </p>
      </div>
      <div className="space-y-1">
        <Label>Default babysitter</Label>
        <Select
          value={settings.default_member_id ?? NONE}
          disabled={mutation.isPending}
          onValueChange={(v) =>
            mutation.mutate({ ...current, default_member_id: v === NONE ? null : v })
          }
        >
          <SelectTrigger className="h-10 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No default</SelectItem>
            {settings.caregivers.map((c) => (
              <SelectItem key={c.family_member_id} value={c.family_member_id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Prefilled on new shifts. Changing it doesn't reassign existing shifts.
        </p>
      </div>
    </section>
  );
}
