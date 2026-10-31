import { PaidSummary, TimesheetPaidFields, usePaidState } from "@/components/TimesheetPaidFields";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Flag } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeField } from "@/components/TimeField";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { TIMESHEETS_STATUS_KEY, useTimesheetsStatus } from "@/lib/use-timesheets-status";
import {
  FREQUENCY_LABEL,
  STATUS_LABEL,
  formatDisplayHours,
  hoursBetween,
  localHours,
  payPeriodFor,
  DEFAULT_PAY_SETTINGS,
  type PayFrequency,
} from "@/lib/timesheet-periods";
import { localDateKey } from "@/lib/google/occurrence";
import {
  getNotifySettings,
  getPaySettings,
  saveNotifySettings,
  type TimesheetNotifySettings,
  countPendingTimesheets,
  countMyTimesheetActions,
  getOwnerManagedTimesheet,
  listOwnerManagedCaregivers,
  ownerDeleteManagedEntry,
  ownerFinalizeManaged,
  ownerSaveManagedEntry,
  ownerEditEntry,
  closeTimesheet,
  listHouseholdTimesheets,
  reviewTimesheet,
  savePaySettings,
  setTimesheetsEnabled,
  type TimesheetView,
} from "@/lib/timesheets.functions";

const fmtDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";

/** Owner-only: pay period + notification configuration (review lives in Activities). */
export function TimesheetSettings() {
  const { isOwner, family } = useCalendar();
  const status = useTimesheetsStatus();
  if (!isOwner || !hasFeature("timesheets", { familyId: family?.id })) return null;
  return (
    <div className="space-y-4">
      <TimesheetsMasterToggle active={status.active} disabled={!status.loaded} />
      {status.active ? (
        <>
          <PayPeriodSettings />
          <NotificationSettings />
        </>
      ) : null}
    </div>
  );
}

/** Owner-only household switch. Turning it off never deletes or changes time cards. */
export function TimesheetsMasterToggle({ active, disabled }: { active: boolean; disabled?: boolean }) {
  const qc = useQueryClient();
  const save = useServerFn(setTimesheetsEnabled);
  const m = useMutation({
    mutationFn: (enabled: boolean) => save({ data: { enabled } }),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? "Timesheets turned on" : "Timesheets turned off");
      void qc.invalidateQueries({ queryKey: TIMESHEETS_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: PENDING_TIMESHEETS_KEY });
      void qc.invalidateQueries({ queryKey: ["household-timesheets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border-soft bg-card px-4 py-3 text-sm">
      <span>
        <span className="block font-semibold">Enable Timesheets</span>
        <span className="block text-xs text-muted-foreground">
          {active
            ? "Track babysitter hours, caregiver time cards and approvals."
            : "Off. Previous time cards stay available to view."}
        </span>
      </span>
      <Switch checked={active} disabled={disabled || m.isPending} onCheckedChange={(v) => m.mutate(v)} />
    </label>
  );
}

export const PENDING_TIMESHEETS_KEY = ["timesheet-pending-count"] as const;

/** Server-authoritative count of submitted timesheets awaiting owner review. */
export function usePendingTimesheetCount(enabled: boolean) {
  const fetch = useServerFn(countPendingTimesheets);
  const { data } = useQuery({
    queryKey: PENDING_TIMESHEETS_KEY,
    queryFn: () => fetch(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return enabled ? data?.count ?? 0 : 0;
}

export const MY_TIMESHEET_ACTIONS_KEY = ["timesheet-my-actions"] as const;

/** Caregiver badge: ended-period drafts + needs-correction timesheets (server-authoritative). */
export function useMyTimesheetActionCount(enabled: boolean) {
  const fetch = useServerFn(countMyTimesheetActions);
  const { data } = useQuery({
    queryKey: MY_TIMESHEET_ACTIONS_KEY,
    queryFn: () => fetch(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 15 * 60_000, // picks up pay-period transitions
    refetchOnWindowFocus: true,
  });
  return enabled ? data?.count ?? 0 : 0;
}

const GROUPS: { label: string; match: (t: TimesheetView) => boolean; empty: string | null }[] = [
  { label: "Current / upcoming", match: (t) => t.status === "draft" && !!t.is_current, empty: null },
  { label: "Needs review", match: (t) => t.status === "submitted", empty: "Nothing waiting for review." },
  { label: "Needs correction", match: (t) => t.status === "needs_correction", empty: "No timesheets waiting on caregiver changes." },
  { label: "Open past periods", match: (t) => t.status === "draft" && !t.is_current, empty: null },
  { label: "Approved / recent history", match: (t) => t.status === "approved" || t.status === "closed", empty: "No approved timesheets yet." },
];

/** Owner action: close an unfinished timesheet (kept as read-only history). */
function CloseTimesheetButton({ id, onClosed }: { id: string; onClosed: () => void }) {
  const close = useServerFn(closeTimesheet);
  const [confirm, setConfirm] = useState(false);
  const m = useMutation({
    mutationFn: () => close({ data: { timesheet_id: id } }),
    onSuccess: () => { toast.success("Timesheet closed"); setConfirm(false); onClosed(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not close"),
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => setConfirm(true)}>Close timesheet</Button>
      <Dialog open={confirm} onOpenChange={(o) => !m.isPending && setConfirm(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Close this timesheet?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">It stays in history as read-only and is no longer treated as open work. No reminders are sent for it.</p>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" disabled={m.isPending} onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={m.isPending} onClick={() => m.mutate()}>Close timesheet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Owner Timesheet hub shown inside Activities. */
export function OwnerTimesheets({ readOnly = false }: { readOnly?: boolean }) {
  const fetch = useServerFn(listHouseholdTimesheets);
  const { data } = useQuery({ queryKey: ["household-timesheets"], queryFn: () => fetch() });
  return (
    <div className="space-y-5 pb-8 md:pb-0">
      {readOnly ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-muted/50 p-3 text-xs text-muted-foreground">
          Timesheets are off. Turn them on in Settings to review or approve time cards.
        </p>
      ) : (
        <OwnerManagedSection />
      )}
      {GROUPS.map((g) => {
        const items = (data ?? []).filter((t) => g.match(t));
        if (g.empty === null && items.length === 0) return null;
        return (
          <section key={g.label} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-bold">{g.label}</h2>
              <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
            </div>
            {data && items.length === 0 && g.empty ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {g.empty}
              </p>
            ) : null}
            {items.map((t) => <ReviewCard key={t.id} sheet={t} readOnly={readOnly} />)}
          </section>
        );
      })}
    </div>
  );
}

function PayPeriodSettings() {
  const qc = useQueryClient();
  const fetch = useServerFn(getPaySettings);
  const save = useServerFn(savePaySettings);
  const { data, isError } = useQuery({ queryKey: ["pay-settings"], queryFn: () => fetch() });
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [frequency, setFrequency] = useState<PayFrequency>(DEFAULT_PAY_SETTINGS.frequency);
  const [anchor, setAnchor] = useState(DEFAULT_PAY_SETTINGS.anchor_date);
  const [cut, setCut] = useState(DEFAULT_PAY_SETTINGS.semimonthly_first_end);
  const [today, setToday] = useState<string | null>(null);
  // Advance display dates on wake/focus and across midnight without persisting an anchor.
  useEffect(() => {
    if (!data) return;
    const update = () => setToday(localDateKey(new Date().toISOString(), data.time_zone));
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [data?.time_zone]);
  const mutation = useMutation({
    mutationFn: () => save({ data: { frequency, anchor_date: anchor, semimonthly_first_end: cut } }),
    onSuccess: () => {
      toast.success("Timesheet schedule saved");
      qc.setQueryData(["pay-settings"], { ...data, frequency, anchor_date: anchor, semimonthly_first_end: cut });
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["pay-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  const proposed = { frequency, anchor_date: anchor, semimonthly_first_end: cut };
  const settings = editing ? proposed : data;
  const valid = !!anchor && Number.isInteger(cut) && cut >= 1 && cut <= 27;
  const current = settings && today && (!editing || valid) ? payPeriodFor(settings, today) : null;
  const next = settings && today && (!editing || valid) ? payPeriodFor(settings, today, 1) : null;
  const changed = !!data && (frequency !== data.frequency || anchor !== data.anchor_date || cut !== data.semimonthly_first_end);
  const selected = new Date(`${anchor}T00:00:00`);
  const startEditing = () => {
    if (!data) return;
    setFrequency(data.frequency);
    setAnchor(data.anchor_date);
    setCut(data.semimonthly_first_end);
    mutation.reset();
    setEditing(true);
  };
  return (
    <div className="space-y-3 rounded-2xl border border-border-soft bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">Timesheet schedule</p>
        {!editing && data ? <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={startEditing}>Change schedule</Button> : null}
      </div>
      {!data ? <p className="text-xs text-muted-foreground">{isError ? "Could not load the schedule." : "Loading…"}</p> : null}
      {!editing && data ? <p className="text-sm font-semibold">{FREQUENCY_LABEL[data.frequency]}</p> : null}
      {editing ? <div className="space-y-3">
      <Label htmlFor="timesheet-frequency">Frequency</Label>
      <Select value={frequency} onValueChange={(v) => setFrequency(v as PayFrequency)}>
        <SelectTrigger id="timesheet-frequency" aria-label="Timesheet schedule frequency" disabled={mutation.isPending}><SelectValue /></SelectTrigger>
        <SelectContent>
          {(["weekly", "biweekly", "monthly", ...(frequency === "semimonthly" ? ["semimonthly"] : [])] as PayFrequency[]).map((f) => (
            <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {frequency === "weekly" || frequency === "biweekly" ? (
        <div className="space-y-1">
          <Label htmlFor="pay-anchor">First day of a known timesheet period</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button id="pay-anchor" variant="outline" className="w-full justify-start text-left font-normal" disabled={mutation.isPending}>
                <CalendarDays className="h-4 w-4 shrink-0" />
                {format(selected, "MMM d, yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="pointer-events-auto w-auto p-0">
              <Calendar mode="single" selected={selected} defaultMonth={selected} initialFocus className="pointer-events-auto p-3"
                onSelect={(date) => { if (!date) return; setAnchor(format(date, "yyyy-MM-dd")); setPickerOpen(false); }} />
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">Choose a date when one of your timesheet periods began. We'll calculate the repeating schedule automatically.</p>
        </div>
      ) : null}
      {frequency === "semimonthly" ? (
        <div className="space-y-1">
          <Label htmlFor="pay-cut">First period ends on day</Label>
          <Input id="pay-cut" type="number" min={1} max={27} value={cut} disabled={mutation.isPending} onChange={(e) => setCut(Number(e.target.value))} />
          <p className="text-xs text-muted-foreground">
            Periods: 1st–{cut}th, then {cut + 1}th–end of month.
          </p>
        </div>
      ) : null}
      {frequency === "monthly" ? <p className="text-xs text-muted-foreground">Periods run from the first through the last day of each month.</p> : null}
      </div> : null}
      {current && next ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Current period</dt><dd className="min-w-0">{fmtDate(current.start)} – {fmtDate(current.end)}</dd>
        <dt className="text-muted-foreground">Next period</dt><dd className="min-w-0">{fmtDate(next.start)} – {fmtDate(next.end)}</dd>
      </dl> : null}
      <p className="text-xs text-muted-foreground">
        Uses the household time zone{data ? ` (${data.time_zone})` : ""}.
      </p>
      {editing ? <>
        <p className="text-xs text-muted-foreground">Existing timesheets stay unchanged. Changes that conflict with their saved dates cannot be saved.</p>
        {mutation.isError ? <p role="alert" className="text-xs text-destructive">{mutation.error instanceof Error ? mutation.error.message : "Could not save the schedule."}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={mutation.isPending || !valid || !changed} onClick={() => mutation.mutate()}>Save Changes</Button>
          <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { setEditing(false); setPickerOpen(false); mutation.reset(); }}>Cancel</Button>
        </div>
      </> : null}
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

function ReviewCard({ sheet, readOnly = false }: { sheet: TimesheetView; readOnly?: boolean }) {
  const qc = useQueryClient();
  const review = useServerFn(reviewTimesheet);
  const search = useSearch({ strict: false }) as { timesheet?: string };
  const [open, setOpen] = useState(search.timesheet === sheet.id);
  const [editing, setEditing] = useState(false);
  const [askNote, setAskNote] = useState(false);
  const [note, setNote] = useState("");
  const tz = sheet.time_zone;
  const scheduled = sheet.entries.reduce((n, e) => n + hoursBetween(e.scheduled_start, e.scheduled_end), 0);
  const actual = sheet.entries.reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["household-timesheets"] });
    void qc.invalidateQueries({ queryKey: PENDING_TIMESHEETS_KEY });
  };
  const mutation = useMutation({
    mutationFn: (action: "approve" | "request_correction") =>
      review({ data: { timesheet_id: sheet.id, action, note: action === "approve" ? null : note.trim() || null } }),
    onSuccess: (_d, action) => {
      toast.success(action === "approve" ? "Timesheet approved" : "Sent back for correction");
      setAskNote(false);
      setNote("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });
  const editable = !readOnly && (sheet.status === "submitted" || sheet.status === "approved");
  return (
    <div className="space-y-2 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          <span className="block font-bold">{sheet.caregiver_name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{fmtDate(sheet.period_start)} – {fmtDate(sheet.period_end)}</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">{STATUS_LABEL[sheet.status]}</Badge>
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
          {open ? "Close" : sheet.status === "submitted" ? "Review" : "View"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border-soft pt-2">
          <p className="text-xs">
            Scheduled {formatDisplayHours(scheduled)} · <span className="font-semibold">Total · {formatDisplayHours(actual).replace(" h", actual === 1 ? " hour" : " hours")}</span>
          </p>
          <PaidSummary entries={sheet.entries} total={actual} />
          {sheet.status === "needs_correction" && sheet.parent_note ? (
            <p className="rounded-xl bg-surface-muted/60 p-2 text-xs"><span className="font-semibold">Your note: </span>{sheet.parent_note}</p>
          ) : null}
          {sheet.entries.map((e) =>
            editing && editable ? (
              <OwnerEntryEditor key={e.id} sheet={sheet} entry={e} onSaved={refresh} />
            ) : (
              <div key={e.id} className="rounded-xl bg-surface-muted/60 p-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{fmtDate(e.work_date)}</span>
                  <span>{formatDisplayHours(hoursBetween(e.actual_start, e.actual_end))}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{fmtTime(e.actual_start, tz)}–{fmtTime(e.actual_end, tz)}</p>
                  {e.caregiver_adjusted ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
                      <Flag className="h-3 w-3" aria-hidden /> Adjusted
                    </span>
                  ) : null}
                </div>
                {e.is_manual ? (
                  <p className="text-xs font-semibold text-primary">Manually added</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Scheduled {fmtTime(e.scheduled_start, tz)}–{fmtTime(e.scheduled_end, tz)}
                  </p>
                )}
                {e.owner_edited_at ? <p className="text-xs font-semibold text-muted-foreground">Edited by parent</p> : null}
                {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
              </div>
            ),
          )}
          {sheet.status === "draft" && sheet.is_current ? (
            <p className="text-xs text-muted-foreground">
              {sheet.entries.length === 0 ? "No shifts saved yet. " : ""}This pay period is still in progress.
            </p>
          ) : sheet.status === "draft" ? (
            <p className="text-xs text-muted-foreground">This pay period ended without a submission.</p>
          ) : null}
          {!readOnly && ((sheet.status === "draft" && !sheet.is_current) || sheet.status === "needs_correction") ? <CloseTimesheetButton id={sheet.id} onClosed={refresh} /> : null}
          {editable && sheet.status === "approved" ? (
            <div className="flex justify-end pt-1">
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => setEditing((v) => !v)}>
                {editing ? "Done editing" : "Edit Timesheet"}
              </Button>
            </div>
          ) : null}
          {editable && sheet.status === "submitted" ? (
            <div className="space-y-2 pt-1">
              <Button size="sm" variant="outline" className="w-full" onClick={() => setEditing((v) => !v)}>
                {editing ? "Done editing" : "Edit timesheet"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" disabled={mutation.isPending || editing} onClick={() => mutation.mutate("approve")}>Approve</Button>
                <Button size="sm" variant="outline" disabled={mutation.isPending || editing} onClick={() => setAskNote(true)}>
                  Request correction
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <Dialog open={askNote} onOpenChange={(o) => !mutation.isPending && setAskNote(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request correction</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`corr-${sheet.id}`}>What needs to be corrected?</Label>
            <Textarea id={`corr-${sheet.id}`} rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" disabled={mutation.isPending} onClick={() => setAskNote(false)}>Cancel</Button>
            <Button disabled={mutation.isPending || !note.trim()} onClick={() => mutation.mutate("request_correction")}>
              Send back for correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OwnerEntryEditor({ sheet, entry, onSaved }: { sheet: TimesheetView; entry: TimesheetView["entries"][number]; onSaved: () => void }) {
  const save = useServerFn(ownerEditEntry);
  const [start, setStart] = useState(entry.actual_start_local);
  const [end, setEnd] = useState(entry.actual_end_local);
  const [note, setNote] = useState(entry.note ?? "");
  const [busy, setBusy] = useState(false);
  const paid = usePaidState(entry);
  const dirty = start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "") || paid.dirty;
  return (
    <div className="space-y-2.5 rounded-xl border border-primary/40 p-3">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{fmtDate(entry.work_date)}</span>
        <span>{formatDisplayHours(localHours(start, end))}</span>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Actual</Label>
        <div className="time-row grid min-w-0 grid-cols-1 items-center gap-2 min-[340px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <TimeField id={`os-${entry.id}`} value={start} onChange={setStart} />
          <span className="hidden text-muted-foreground min-[340px]:block" aria-hidden>→</span>
          <TimeField id={`oe-${entry.id}`} value={end} onChange={setEnd} />
        </div>
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <TimesheetPaidFields id={`o-${entry.id}`} state={paid} maxHours={localHours(start, end)} />
      {dirty ? <div className="grid grid-cols-2 gap-2"><Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => { setStart(entry.actual_start_local); setEnd(entry.actual_end_local); setNote(entry.note ?? ""); paid.reset(); }}
      >
        Cancel
      </Button><Button
        size="sm"
        variant="outline"
        disabled={busy || !dirty || !start || !end || !paid.valid(localHours(start, end))}
        onClick={async () => {
          setBusy(true);
          try {
            await save({ data: { timesheet_id: sheet.id, entry_id: entry.id, start, end, note: note || null, ...paid.payload() } });
            toast.success("Entry updated");
            onSaved();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        Save changes
      </Button></div> : null}
    </div>
  );
}

/* ------------------------------------------- owner-managed (no sign-in) cards */

function OwnerManagedSection() {
  const fetch = useServerFn(listOwnerManagedCaregivers);
  const { data } = useQuery({ queryKey: ["owner-managed-caregivers"], queryFn: () => fetch() });
  if (!data || data.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-bold">Owner-managed time cards</h2>
        <span className="text-xs font-semibold text-muted-foreground">{data.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        For caregivers without sign-in access. You confirm their hours; nothing is sent to them.
      </p>
      {data.map((c) => <OwnerManagedCard key={c.member_id} memberId={c.member_id} name={c.name} attention={c.attention_offsets} />)}
    </section>
  );
}

function OwnerManagedCard({ memberId, name, attention }: { memberId: string; name: string; attention: number[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const fetch = useServerFn(getOwnerManagedTimesheet);
  const finalize = useServerFn(ownerFinalizeManaged);
  const key = ["owner-managed-sheet", memberId, offset];
  const { data: sheet } = useQuery({ queryKey: key, queryFn: () => fetch({ data: { member_id: memberId, offset } }), enabled: open });
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["owner-managed-sheet", memberId] });
    void qc.invalidateQueries({ queryKey: ["household-timesheets"] });
    void qc.invalidateQueries({ queryKey: ["owner-managed-caregivers"] });
  };
  const pending = attention.filter((o) => o !== offset);
  const mutation = useMutation({
    mutationFn: () => finalize({ data: { timesheet_id: sheet!.id } }),
    onSuccess: () => {
      toast.success("Time card confirmed");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not confirm"),
  });
  const editable = sheet ? (sheet.status === "draft" || sheet.status === "needs_correction") && !sheet.before_start : false;
  const actual = (sheet?.entries ?? []).reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0);
  return (
    <div className="space-y-2 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          <span className="block font-bold">{name}</span>
          <span className="block text-xs text-muted-foreground">Owner-managed · No sign-in access</span>
          {attention.length ? (
            <span className="mt-1 block text-xs font-semibold text-destructive">
              {attention.length} previous time card{attention.length === 1 ? " needs" : "s need"} attention
            </span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{open ? "Close" : "Open"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border-soft pt-2">
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1">
            <Button size="icon" variant="ghost" className="h-11 w-11" disabled={offset <= -60} onClick={() => setOffset((o) => o - 1)} aria-label="Previous pay period">‹</Button>
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 text-center text-xs font-semibold">
              <span>{sheet ? `${fmtDate(sheet.period_start)} – ${fmtDate(sheet.period_end)}` : "Loading…"}</span>
              {sheet ? <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">{STATUS_LABEL[sheet.status]}</Badge> : null}
            </div>
            <Button size="icon" variant="ghost" className="h-11 w-11" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)} aria-label="Next pay period">›</Button>
          </div>
          {offset !== 0 ? (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setOffset(0)}
              >
                Current Pay Period
              </Button>
            </div>
          ) : null}
          {pending.length ? (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">Needs attention:</span>
              {pending.map((o) => (
                <Button key={o} size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={() => setOffset(o)}>
                  {o === -1 ? "Last period" : `${-o} periods ago`}
                </Button>
              ))}
            </div>
          ) : null}
          {sheet ? (
            <>
              <p className="text-xs font-semibold">Total · {formatDisplayHours(actual).replace(" h", actual === 1 ? " hour" : " hours")}</p>
              <PaidSummary entries={sheet.entries} total={actual} />
              {sheet.entries.length === 0 && !adding ? (
                <p className="text-xs text-muted-foreground">No shifts in this pay period.</p>
              ) : null}
              {sheet.entries.map((e) =>
                editable ? (
                  <ManagedEntryEditor key={e.id} sheet={sheet} entry={e} onSaved={refresh} />
                ) : (
                  <div key={e.id} className="rounded-xl bg-surface-muted/60 p-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{fmtDate(e.work_date)}</span>
                      <span>{formatDisplayHours(hoursBetween(e.actual_start, e.actual_end))}</span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">Actual</p>
                    <p className="text-xs">{fmtTime(e.actual_start, sheet.time_zone)} <span aria-hidden>→</span> {fmtTime(e.actual_end, sheet.time_zone)}</p>
                    {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
                  </div>
                ),
              )}
              {editable && adding ? (
                <ManagedEntryEditor sheet={sheet} entry={null} onSaved={() => { setAdding(false); refresh(); }} />
              ) : null}
              {sheet.before_start ? (
                <p className="text-xs text-muted-foreground">Before this caregiver's Timesheet start date.</p>
              ) : null}
              {editable && offset < 0 ? <CloseTimesheetButton id={sheet.id} onClosed={refresh} /> : null}
              {editable ? (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add entry"}</Button>
                  <Button size="sm" disabled={mutation.isPending || sheet.entries.length === 0} onClick={() => mutation.mutate()}>
                    Confirm time card
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ManagedEntryEditor({
  sheet,
  entry,
  onSaved,
}: {
  sheet: TimesheetView;
  entry: TimesheetView["entries"][number] | null;
  onSaved: () => void;
}) {
  const save = useServerFn(ownerSaveManagedEntry);
  const remove = useServerFn(ownerDeleteManagedEntry);
  const [date, setDate] = useState(entry?.work_date ?? sheet.period_start);
  const [start, setStart] = useState(entry?.actual_start_local ?? "");
  const [end, setEnd] = useState(entry?.actual_end_local ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const paid = usePaidState(entry);
  const liveHours = start && end ? localHours(start, end) : 0;
  const dirty = !entry || start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "") || paid.dirty;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const idp = entry?.id ?? "new";
  return (
    <div className="space-y-2.5 rounded-xl border border-primary/40 p-3">
      {entry ? (
        <div className="flex justify-between gap-2">
          <span className="font-semibold">{fmtDate(entry.work_date)}</span>
          <span>{start && end ? formatDisplayHours(localHours(start, end)) : ""}</span>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`md-${idp}`} className="text-xs">Date</Label>
          <Input id={`md-${idp}`} type="date" min={sheet.period_start} max={sheet.period_end} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      {entry && !entry.is_manual ? (
        <p className="text-xs text-muted-foreground">
          Scheduled · {fmtTime(entry.scheduled_start, sheet.time_zone)}–{fmtTime(entry.scheduled_end, sheet.time_zone)}
        </p>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs">Actual</Label>
        <div className="time-row grid min-w-0 grid-cols-1 items-center gap-2 min-[340px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <TimeField id={`ms-${idp}`} value={start} onChange={setStart} />
          <span className="hidden text-muted-foreground min-[340px]:block" aria-hidden>→</span>
          <TimeField id={`me-${idp}`} value={end} onChange={setEnd} />
        </div>
      </div>
      <Input aria-label="Add note (optional)" placeholder="Add note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <TimesheetPaidFields id={`m-${idp}`} state={paid} maxHours={liveHours} />
      <div className={entry?.is_manual && dirty ? "grid grid-cols-2 gap-2" : ""}>
        {dirty ? <Button
          size="sm"
          variant={entry ? "outline" : "default"}
          className="w-full"
          disabled={busy || !start || !end || !date || !paid.valid(liveHours)}
          onClick={() =>
            void run(
              () => save({ data: { timesheet_id: sheet.id, entry_id: entry?.id ?? null, work_date: entry?.work_date ?? date, start, end, note: note || null, ...paid.payload() } }),
              entry ? "Entry updated" : "Entry added",
            )
          }
        >
          {entry ? "Save changes" : "Add entry"}
        </Button> : null}
        {entry?.is_manual ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => remove({ data: { timesheet_id: sheet.id, entry_id: entry.id } }), "Entry removed")}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
