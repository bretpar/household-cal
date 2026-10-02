import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import {
  FREQUENCY_LABEL,
  STATUS_LABEL,
  formatHours,
  hoursBetween,
  localHours,
  type PayFrequency,
} from "@/lib/timesheet-periods";
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
  listHouseholdTimesheets,
  reviewTimesheet,
  savePaySettings,
  type TimesheetView,
} from "@/lib/timesheets.functions";

const fmtDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";

/** Owner-only: pay period + notification configuration (review lives in Activities). */
export function TimesheetSettings() {
  const { isOwner, family } = useCalendar();
  if (!isOwner || !hasFeature("timesheets", { familyId: family?.id })) return null;
  return (
    <div className="space-y-4">
      <PayPeriodSettings />
      <NotificationSettings />
    </div>
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

const GROUPS: { label: string; match: (s: TimesheetView["status"]) => boolean; empty: string }[] = [
  { label: "Needs review", match: (s) => s === "submitted", empty: "Nothing waiting for review." },
  { label: "Needs correction", match: (s) => s === "needs_correction", empty: "No timesheets waiting on caregiver changes." },
  { label: "Approved / recent history", match: (s) => s === "approved", empty: "No approved timesheets yet." },
];

/** Owner Timesheet hub shown inside Activities. */
export function OwnerTimesheets() {
  const fetch = useServerFn(listHouseholdTimesheets);
  const { data } = useQuery({ queryKey: ["household-timesheets"], queryFn: () => fetch() });
  return (
    <div className="space-y-5">
      <OwnerManagedSection />
      {GROUPS.map((g) => {
        const items = (data ?? []).filter((t) => g.match(t.status));
        return (
          <section key={g.label} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-bold">{g.label}</h2>
              <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
            </div>
            {data && items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {g.empty}
              </p>
            ) : null}
            {items.map((t) => <ReviewCard key={t.id} sheet={t} />)}
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

function ReviewCard({ sheet }: { sheet: TimesheetView }) {
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
  const editable = sheet.status === "submitted";
  return (
    <div className="space-y-2 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          <span className="block font-bold">{sheet.caregiver_name}</span>
          <span className="block text-xs text-muted-foreground">
            {fmtDate(sheet.period_start)} – {fmtDate(sheet.period_end)} · {sheet.owner_managed ? "Owner-managed · " : ""}{STATUS_LABEL[sheet.status]}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
          {open ? "Close" : sheet.status === "submitted" ? "Review" : "Open"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border-soft pt-2">
          <p className="text-xs">
            Scheduled {formatHours(scheduled)} · <span className="font-semibold">Actual {formatHours(actual)}</span>
          </p>
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
                {e.owner_edited_at ? <p className="text-xs font-semibold text-muted-foreground">Edited by parent</p> : null}
                {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
              </div>
            ),
          )}
          {editable ? (
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
  const dirty = start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "");
  return (
    <div className="space-y-2.5 rounded-xl border border-primary/40 p-3">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{fmtDate(entry.work_date)}</span>
        <span>{formatHours(localHours(start, end))}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`os-${entry.id}`} className="text-xs">Actual start</Label>
          <Input id={`os-${entry.id}`} type="time" className="w-full min-w-0" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`oe-${entry.id}`} className="text-xs">Actual end</Label>
          <Input id={`oe-${entry.id}`} type="time" className="w-full min-w-0" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <Button
        size="sm"
        className="w-full"
        disabled={busy || !dirty || !start || !end}
        onClick={async () => {
          setBusy(true);
          try {
            await save({ data: { timesheet_id: sheet.id, entry_id: entry.id, start, end, note: note || null } });
            toast.success("Entry updated");
            onSaved();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        Save entry
      </Button>
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
      {data.map((c) => <OwnerManagedCard key={c.member_id} memberId={c.member_id} name={c.name} />)}
    </section>
  );
}

function OwnerManagedCard({ memberId, name }: { memberId: string; name: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(-1);
  const fetch = useServerFn(getOwnerManagedTimesheet);
  const finalize = useServerFn(ownerFinalizeManaged);
  const key = ["owner-managed-sheet", memberId, offset];
  const { data: sheet } = useQuery({ queryKey: key, queryFn: () => fetch({ data: { member_id: memberId, offset } }), enabled: open });
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["owner-managed-sheet", memberId] });
    void qc.invalidateQueries({ queryKey: ["household-timesheets"] });
  };
  const mutation = useMutation({
    mutationFn: () => finalize({ data: { timesheet_id: sheet!.id } }),
    onSuccess: () => {
      toast.success("Time card approved");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
  });
  const editable = sheet ? sheet.status === "draft" || sheet.status === "needs_correction" : false;
  const actual = (sheet?.entries ?? []).reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0);
  return (
    <div className="space-y-2 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0">
          <span className="block font-bold">{name}</span>
          <span className="block text-xs text-muted-foreground">Owner-managed · No sign-in access</span>
        </span>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{open ? "Close" : "Open"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border-soft pt-2">
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" disabled={offset <= -60} onClick={() => setOffset((o) => o - 1)} aria-label="Previous pay period">‹</Button>
            <span className="text-xs font-semibold">
              {sheet ? `${fmtDate(sheet.period_start)} – ${fmtDate(sheet.period_end)} · Owner-managed · ${STATUS_LABEL[sheet.status]}` : "Loading…"}
            </span>
            <Button size="sm" variant="ghost" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)} aria-label="Next pay period">›</Button>
          </div>
          {sheet ? (
            <>
              <p className="text-xs font-semibold">Actual {formatHours(actual)}</p>
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
                      <span>{formatHours(hoursBetween(e.actual_start, e.actual_end))}</span>
                    </div>
                    <p className="text-xs">Actual {fmtTime(e.actual_start, sheet.time_zone)} – {fmtTime(e.actual_end, sheet.time_zone)}</p>
                    {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
                  </div>
                ),
              )}
              {editable && adding ? (
                <ManagedEntryEditor sheet={sheet} entry={null} onSaved={() => { setAdding(false); refresh(); }} />
              ) : null}
              {editable ? (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add entry"}</Button>
                  <Button size="sm" disabled={mutation.isPending || sheet.entries.length === 0} onClick={() => mutation.mutate()}>
                    Approve time card
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
  const dirty = !entry || start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "");
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
          <span>{start && end ? formatHours(localHours(start, end)) : ""}</span>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`md-${idp}`} className="text-xs">Date</Label>
          <Input id={`md-${idp}`} type="date" min={sheet.period_start} max={sheet.period_end} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      {entry && !entry.is_manual ? (
        <p className="text-xs text-muted-foreground">
          Scheduled {fmtTime(entry.scheduled_start, sheet.time_zone)} – {fmtTime(entry.scheduled_end, sheet.time_zone)}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`ms-${idp}`} className="text-xs">Actual start</Label>
          <Input id={`ms-${idp}`} type="time" className="w-full min-w-0" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`me-${idp}`} className="text-xs">Actual end</Label>
          <Input id={`me-${idp}`} type="time" className="w-full min-w-0" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <Input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      <div className={entry?.is_manual ? "grid grid-cols-2 gap-2" : ""}>
        <Button
          size="sm"
          className="w-full"
          disabled={busy || !dirty || !start || !end || !date}
          onClick={() =>
            void run(
              () => save({ data: { timesheet_id: sheet.id, entry_id: entry?.id ?? null, work_date: entry?.work_date ?? date, start, end, note: note || null } }),
              entry ? "Entry updated" : "Entry added",
            )
          }
        >
          {entry ? "Save entry" : "Add entry"}
        </Button>
        {entry?.is_manual ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => remove({ data: { timesheet_id: sheet.id, entry_id: entry.id } }), "Entry removed")}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
