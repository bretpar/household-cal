import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { useState } from "react";
import { ChildcareCalendarSelect, ChildcareSetupFields, useChildcareSetup } from "@/components/ChildcareSetup";

const NONE = "__none__";

/** Owner-only: which calendar holds babysitting shifts and who the default babysitter is. */
export function BabysitterShiftSettings() {
  const { isOwner, sources } = useCalendar();
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getShiftSettings);
  const save = useServerFn(updateShiftSettings);
  const setup = useChildcareSetup();
  const [setupOpen, setSetupOpen] = useState(false);
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
    mutationFn: () => setup.confirm(),
    onSuccess: () => {
      toast.success("Babysitter calendar ready");
      setSetupOpen(false);
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
        {!settings.calendar_source_id || setupOpen ? <div className="mt-3 space-y-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setSetupOpen(!setupOpen)} aria-expanded={setupOpen}>Set up childcare scheduling</Button>
          {setupOpen ? <>
            <p className="text-sm text-muted-foreground">Organize babysitting shifts and caregiver schedules.</p>
            <ChildcareSetupFields setup={setup} disabled={busy} />
            <Button type="button" disabled={busy || !setup.ready} onClick={() => creation.mutate()}>{creation.isPending ? "Saving…" : "Save childcare setup"}</Button>
          </> : null}
        </div> : null}
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
