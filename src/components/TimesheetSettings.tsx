import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCalendar } from "@/lib/calendar-store";
import {
  FREQUENCY_LABEL,
  STATUS_LABEL,
  formatHours,
  hoursBetween,
  type PayFrequency,
} from "@/lib/timesheet-periods";
import {
  getNotifySettings,
  getPaySettings,
  saveNotifySettings,
  type TimesheetNotifySettings,
  listHouseholdTimesheets,
  reviewTimesheet,
  savePaySettings,
  type TimesheetView,
} from "@/lib/timesheets.functions";

const fmtDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";

/** Owner-only: pay period configuration and caregiver timesheet review. */
export function TimesheetSettings() {
  const { isOwner } = useCalendar();
  if (!isOwner) return null;
  return (
    <div className="space-y-4">
      <PayPeriodSettings />
      <NotificationSettings />
      <TimesheetReview />
    </div>
  );
}

function PayPeriodSettings() {
  const qc = useQueryClient();
  const fetch = useServerFn(getPaySettings);
  const save = useServerFn(savePaySettings);
  const { data } = useQuery({ queryKey: ["pay-settings"], queryFn: () => fetch() });
  const [frequency, setFrequency] = useState<PayFrequency>("biweekly");
  const [anchor, setAnchor] = useState("2026-01-04");
  const [cut, setCut] = useState(15);
  useEffect(() => {
    if (!data) return;
    setFrequency(data.frequency);
    setAnchor(data.anchor_date);
    setCut(data.semimonthly_first_end);
  }, [data]);
  const mutation = useMutation({
    mutationFn: () => save({ data: { frequency, anchor_date: anchor, semimonthly_first_end: cut } }),
    onSuccess: () => {
      toast.success("Pay period saved");
      void qc.invalidateQueries({ queryKey: ["pay-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <div className="space-y-3 rounded-2xl border border-border-soft bg-card p-4">
      <p className="text-sm font-bold">Pay period</p>
      <Select value={frequency} onValueChange={(v) => setFrequency(v as PayFrequency)}>
        <SelectTrigger aria-label="Pay period"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(FREQUENCY_LABEL) as PayFrequency[]).map((f) => (
            <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {frequency === "weekly" || frequency === "biweekly" ? (
        <div className="space-y-1">
          <Label htmlFor="pay-anchor">A pay period starts on</Label>
          <Input id="pay-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </div>
      ) : null}
      {frequency === "semimonthly" ? (
        <div className="space-y-1">
          <Label htmlFor="pay-cut">First period ends on day</Label>
          <Input id="pay-cut" type="number" min={1} max={27} value={cut} onChange={(e) => setCut(Number(e.target.value))} />
          <p className="text-xs text-muted-foreground">
            Periods: 1st–{cut}th, then {cut + 1}th–end of month.
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Uses the household time zone{data ? ` (${data.time_zone})` : ""}.
      </p>
      <Button size="sm" disabled={mutation.isPending || !anchor} onClick={() => mutation.mutate()}>Save</Button>
    </div>
  );
}

const NOTIFY_LABELS: [keyof TimesheetNotifySettings, string][] = [
  ["notify_ready", "Email caregiver when a pay period is ready for review"],
  ["notify_reminder", "Remind caregiver if not submitted (after 24 hours)"],
  ["notify_owner_submit", "Email owner when caregiver submits"],
  ["notify_correction", "Email caregiver when correction is requested"],
  ["notify_approved", "Email caregiver when timesheet is approved"],
];

function NotificationSettings() {
  const qc = useQueryClient();
  const fetch = useServerFn(getNotifySettings);
  const save = useServerFn(saveNotifySettings);
  const { data } = useQuery({ queryKey: ["timesheet-notify-settings"], queryFn: () => fetch() });
  const mutation = useMutation({
    mutationFn: (next: TimesheetNotifySettings) => save({ data: next }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["timesheet-notify-settings"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <div className="space-y-3 rounded-2xl border border-border-soft bg-card p-4">
      <p className="text-sm font-bold">Email notifications</p>
      {NOTIFY_LABELS.map(([key, label]) => (
        <label key={key} className="flex items-center justify-between gap-3 text-sm">
          <span>{label}</span>
          <Switch
            checked={data ? data[key] : true}
            disabled={!data || mutation.isPending}
            onCheckedChange={(v) => data && mutation.mutate({ ...data, [key]: v })}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">Caregivers who turn off timesheet emails won't receive them.</p>
    </div>
  );
}

function TimesheetReview() {
  const fetch = useServerFn(listHouseholdTimesheets);
  const { data } = useQuery({ queryKey: ["household-timesheets"], queryFn: () => fetch() });
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold">Caregiver timesheets</p>
      {data && data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No submitted timesheets yet.
        </p>
      ) : null}
      {(data ?? []).map((t) => <ReviewCard key={t.id} sheet={t} />)}
    </div>
  );
}

function ReviewCard({ sheet }: { sheet: TimesheetView }) {
  const qc = useQueryClient();
  const review = useServerFn(reviewTimesheet);
  const search = useSearch({ strict: false }) as { timesheet?: string };
  const [open, setOpen] = useState(search.timesheet === sheet.id);
  const [note, setNote] = useState("");
  const tz = sheet.time_zone;
  const scheduled = sheet.entries.reduce((n, e) => n + hoursBetween(e.scheduled_start, e.scheduled_end), 0);
  const actual = sheet.entries.reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0);
  const mutation = useMutation({
    mutationFn: (action: "approve" | "request_correction") =>
      review({ data: { timesheet_id: sheet.id, action, note: note || null } }),
    onSuccess: (_d, action) => {
      toast.success(action === "approve" ? "Timesheet approved" : "Correction requested");
      void qc.invalidateQueries({ queryKey: ["household-timesheets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });
  return (
    <div className="space-y-2 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span>
          <span className="block font-bold">{sheet.caregiver_name}</span>
          <span className="block text-xs text-muted-foreground">
            {fmtDate(sheet.period_start)} – {fmtDate(sheet.period_end)} · {STATUS_LABEL[sheet.status]}
          </span>
        </span>
        <span className="text-right text-xs">
          <span className="block">Scheduled {formatHours(scheduled)}</span>
          <span className="block font-semibold">Actual {formatHours(actual)}</span>
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border-soft pt-2">
          {sheet.entries.map((e) => (
            <div key={e.id} className="rounded-xl bg-surface-muted/60 p-2">
              <div className="flex justify-between">
                <span className="font-semibold">{fmtDate(e.work_date)}</span>
                <span>{formatHours(hoursBetween(e.actual_start, e.actual_end))}</span>
              </div>
              {e.is_manual ? (
                <p className="text-xs font-semibold text-primary">Manually added</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Scheduled {fmtTime(e.scheduled_start, tz)} – {fmtTime(e.scheduled_end, tz)}
                </p>
              )}
              <p className="text-xs">Actual {fmtTime(e.actual_start, tz)} – {fmtTime(e.actual_end, tz)}</p>
              {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
            </div>
          ))}
          {sheet.status === "submitted" ? (
            <div className="space-y-2">
              <Input placeholder="Note for correction (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={mutation.isPending} onClick={() => mutation.mutate("approve")}>Approve</Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={mutation.isPending} onClick={() => mutation.mutate("request_correction")}>
                  Request correction
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
