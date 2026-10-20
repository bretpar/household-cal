import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CalendarPlus } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getShiftSettings, updateShiftSettings } from "@/lib/babysitter-shifts.functions";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import { isWritableDestination, type CalendarSource } from "@/lib/family-data";
import { createOfcCalendar } from "@/lib/ofc-calendars.functions";

const NONE = "__none__";

/** Same eligible destinations for childcare setup and ongoing Settings. */
export function ChildcareCalendarSelect({ value, onValueChange, sources, disabled = false }: {
  value: string | null;
  onValueChange: (value: string | null) => void;
  sources: CalendarSource[];
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onValueChange(v === NONE ? null : v)}>
      <SelectTrigger aria-label="Calendar for babysitting shifts" className="h-10 rounded-xl min-w-0 [&>span]:truncate">
        <SelectValue placeholder="Choose a calendar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not set</SelectItem>
        {sources.filter(isWritableDestination).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.provider === "google" ? "Google" : "OFC"}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Owner-only: which calendar holds babysitting shifts and who the default babysitter is. */
export function BabysitterShiftSettings() {
  const { isOwner, sources } = useCalendar();
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getShiftSettings);
  const save = useServerFn(updateShiftSettings);
  const createCalendar = useServerFn(createOfcCalendar);
  const settings = useQuery({
    queryKey: ["shift-settings"],
    queryFn: () => fetchSettings(),
    enabled: isOwner,
  }).data;
  const mutation = useMutation({
    mutationFn: (next: { calendar_source_id: string | null; default_member_id: string | null }) =>
      save({ data: next }),
    onSuccess: () => {
      toast.success("Childcare scheduling saved");
      void qc.invalidateQueries({ queryKey: ["shift-settings"] });
      void qc.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const creation = useMutation({
    mutationFn: () => createCalendar({ data: {
      name: "Babysitter", color: "sky", icon: "sitter", display_mode: "events", onboarding_babysitter: true,
    } }),
    onSuccess: () => {
      toast.success("Babysitter calendar ready");
      void qc.invalidateQueries({ queryKey: ["shift-settings"] });
      void qc.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create calendar"),
  });
  if (!isOwner || !settings) return null;
  const busy = mutation.isPending || creation.isPending;
  const current = {
    calendar_source_id: settings.calendar_source_id,
    default_member_id: settings.default_member_id,
  };

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <Label>Calendar for babysitting shifts</Label>
        <ChildcareCalendarSelect value={settings.calendar_source_id} sources={sources} disabled={busy}
          onValueChange={(v) => mutation.mutate({ ...current, calendar_source_id: v })} />
        <p className="text-xs text-muted-foreground">
          New shifts use this calendar. Existing events and assignments stay unchanged. Apple subscriptions are read-only and cannot be used.
        </p>
        {!settings.calendar_source_id ? <Button type="button" variant="outline" className="mt-2 h-auto min-h-10 whitespace-normal text-left" disabled={busy} onClick={() => creation.mutate()}>
          <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />
          {creation.isPending ? "Creating…" : "Create a Babysitter calendar in OFC"}
        </Button> : null}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Caregivers</h3>
        <p className="text-xs text-muted-foreground">Add caregivers and manage invitations and app access separately in Household. A caregiver does not need an account to be assigned to shifts.</p>
      </div>
      <div className="space-y-1">
        <Label>Default babysitter</Label>
        <Select
          value={settings.default_member_id ?? NONE}
          disabled={busy}
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
