import { PaidSummary, TimesheetPaidFields, usePaidState } from "@/components/TimesheetPaidFields";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { format, startOfWeek } from "date-fns";
import { getVerifiedMembership, subscribeVerifiedMembership } from "@/lib/auth-guard";
import { compactPeriod, SummaryStat, summaryAction, TimesheetSummaryCard } from "@/components/BabysitterTimesheetPresentation";
import { BabysitterTimesheetPdfActions } from "@/components/BabysitterTimesheetPdfActions";
import { householdTimesheetDoc, householdShiftStatus } from "@/lib/household-timesheet-pdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CaregiverOnly } from "@/components/CaregiverGate";
import { requestCalendarDayView, writeCalendarAnchor } from "@/lib/calendar-anchor-session";
import {
  clearTimesheetDraft,
  draftKey,
  readTimesheetDraft,
  readTimesheetPeriod,
  writeTimesheetDraft,
  writeTimesheetPeriod,
} from "@/lib/timesheet-draft-session";
import { TimeField } from "@/components/TimeField";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { useTimesheetsStatus } from "@/lib/use-timesheets-status";
import { timesheetStatusRevalidated } from "@/lib/timesheet-editability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatHoursLabel,
  hoursBetween,
  localHours,
  addDaysKey,
} from "@/lib/timesheet-periods";
import { MY_TIMESHEET_ACTIONS_KEY } from "@/components/TimesheetSettings";
import {
  deleteManualEntry,
  getMyTimesheet,
  saveTimesheetEntry,
  submitTimesheet,
  type TimesheetEntry,
  type TimesheetView,
  countsTowardTotals,
  resolveShiftConflict,
} from "@/lib/timesheets.functions";
import { TimesheetConflicts } from "@/components/TimesheetConflicts";

export const Route = createFileRoute("/_authenticated/timesheet")({
  validateSearch: (search: Record<string, unknown>): { period?: string } =>
    typeof search["period"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["period"]) ? { period: search["period"] } : {},
  head: () => ({
    meta: [
      { title: "Timesheet — Family Calendar" },
      { name: "description", content: "Review your babysitting hours and submit your timesheet." },
      { property: "og:title", content: "Timesheet — Family Calendar" },
      { property: "og:description", content: "Caregiver timesheets for each pay period." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetRoute,
});

function TimesheetGate() {
  const { family } = useCalendar();
  const ts = useTimesheetsStatus();
  if (!hasFeature("timesheets", { familyId: family?.id }) || (ts.loaded && !ts.active && !ts.history)) {
    return <p className="text-sm text-muted-foreground">Timesheets aren't available for this household.</p>;
  }
  return <TimesheetPage />;
}

function TimesheetRoute() {
  return (
    <CaregiverOnly fallback="/today">
      <AppShell>
        <TimesheetGate />
      </AppShell>
    </CaregiverOnly>
  );
}

export const fmtDate = (key: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
export const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";

function TimesheetPage() {
  const { period } = Route.useSearch();
  const [linkPeriod, setLinkPeriod] = useState(() => period ?? readTimesheetPeriod());
  const [offset, setOffset] = useState(0);
  const fetchSheet = useServerFn(getMyTimesheet);
  const { family } = useCalendar();
  const membership = useSyncExternalStore(subscribeVerifiedMembership, getVerifiedMembership, () => null);
  const scopeKey = membership && family?.id === membership.family_id ? `${membership.userId}:${membership.family_id}:${membership.role}` : "";
  const [previewState, setPreviewState] = useState<{ key: string; values: Record<string, number> }>({ key: "", values: {} });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const query = useQuery({
    queryKey: ["my-timesheet", scopeKey, linkPeriod ? `p:${linkPeriod}` : offset],
    enabled: Boolean(scopeKey),
    queryFn: () => fetchSheet({ data: { offset, period_start: linkPeriod } }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const sheet = scopeKey ? query.data : undefined;
  const previewKey = `${scopeKey}:${sheet?.id ?? "loading"}`;
  const preview = previewState.key === previewKey ? previewState.values : {};
  const setPreview: Dispatch<SetStateAction<Record<string, number>>> = update => setPreviewState(prior => ({
    key: previewKey, values: typeof update === "function" ? update(prior.key === previewKey ? prior.values : {}) : update,
  }));
  // Remember the shown pay period for this session so returning restores it.
  useEffect(() => {
    if (sheet) writeTimesheetPeriod(sheet.period_start);
  }, [sheet?.period_start]);
  // Leaving an emailed deep link: continue navigating from the resolved period.
  const move = (delta: number) => {
    const base = linkPeriod && sheet ? sheet.offset : offset;
    setLinkPeriod(undefined);
    setOffset(Math.min(12, base + delta));
  };
  // Offset 0 is the period containing today, as computed by the server from the
  // household schedule and time zone; jump straight back to it.
  const goCurrent = () => {
    setLinkPeriod(undefined);
    setOffset(0);
  };

  return (
    <div className="mx-auto min-w-0 max-w-2xl space-y-4 pb-4 md:pb-0">
      <HouseholdSummary sheet={sheet} familyName={scopeKey ? family?.name ?? "Family" : "Family"} scopeKey={scopeKey} preview={preview} now={now}
        statusRevalidated={timesheetStatusRevalidated(query)} previous={() => move(-1)} next={() => move(1)} current={goCurrent} />
      {query.error ? (
        <p className="text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Could not load timesheet"}
        </p>
      ) : null}
      {query.error && <Button variant="outline" className="w-full" onClick={() => void query.refetch()}>Try again</Button>}
      {sheet ? (sheet.upcoming ? <UpcomingBody sheet={sheet} now={now} /> : <SheetBody key={`${scopeKey}:${sheet.id}`} sheet={sheet} now={now} preview={preview} setPreview={setPreview} statusRevalidated={timesheetStatusRevalidated(query)} />) : null}
    </div>
  );
}

function HouseholdSummary({ sheet, familyName, scopeKey, preview, now, statusRevalidated, previous, next, current }: {
  sheet: (TimesheetView & { offset: number; can_next: boolean }) | undefined; familyName: string; scopeKey: string;
  preview: Record<string, number>; now: number; statusRevalidated: boolean; previous: () => void; next: () => void; current: () => void;
}) {
  const qc = useQueryClient();
  const submit = useServerFn(submitTimesheet);
  const doc = useMemo(() => {
    if (!sheet) return null;
    const cachedName = qc.getQueriesData<TimesheetView>({ queryKey: ["my-timesheet", scopeKey] }).find(([, data]) => data?.caregiver_name)?.[1]?.caregiver_name ?? "";
    return householdTimesheetDoc({ ...sheet, entries: sheet.entries.filter(countsTowardTotals) }, familyName, cachedName);
  }, [sheet, familyName, scopeKey, qc]);
  const entries = sheet?.entries.filter(countsTowardTotals) ?? [];
  const total = entries.reduce((n, e) => n + (preview[e.id] ?? hoursBetween(e.actual_start, e.actual_end)), 0) + (preview["new"] ?? 0);
  const scheduled = entries.reduce((n, e) => n + hoursBetween(e.scheduled_start, e.scheduled_end), 0);
  const statuses = sheet ? entries.map(e => householdShiftStatus(e, sheet, now)) : [];
  const needs = statuses.filter(s => s === "unconfirmed").length;
  const confirmed = statuses.filter(s => s === "confirmed" || s === "adjusted").length;
  const editable = Boolean(sheet && !sheet.upcoming && statusRevalidated && (sheet.status === "draft" || sheet.status === "needs_correction") && !sheet.before_start && !sheet.read_only);
  const mutation = useMutation({
    mutationFn: () => { if (!sheet || !editable) throw new Error("This timesheet cannot be submitted"); return submit({ data: { timesheet_id: sheet.id } }); },
    onSuccess: () => { toast.success("Timesheet submitted"); void qc.invalidateQueries({ queryKey: ["my-timesheet"] }); void qc.invalidateQueries({ queryKey: MY_TIMESHEET_ACTIONS_KEY }); },
    onError: e => toast.error(e instanceof Error ? e.message : "Could not submit"),
  });
  const label = !sheet ? "Submit Timesheet" : sheet.status === "submitted" ? "Awaiting Review" : sheet.status === "needs_correction" ? "Resubmit Timesheet" : sheet.status === "approved" ? "Approved" : sheet.status === "closed" ? "Closed" : "Submit Timesheet";
  return <>
    <TimesheetSummaryCard familyName={familyName} period={sheet ? compactPeriod(sheet.period_start, sheet.period_end) : ""} previous={previous} next={next} nextDisabled={!sheet?.can_next} current={sheet?.offset !== 0 ? current : undefined} loading={!sheet}>
      <dl className="grid grid-cols-3 gap-2"><SummaryStat label="Total" value={formatHoursLabel(total)} /><SummaryStat label="Scheduled" value={formatHoursLabel(scheduled)} /><SummaryStat label="Difference" value={`${total > scheduled ? "+" : ""}${formatHoursLabel(total - scheduled)}`} /></dl>
      <PaidSummary entries={entries} total={total} className="text-xs text-primary-foreground/80" />
      {!sheet?.upcoming && <Button className={summaryAction} disabled={!editable || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Submitting…" : label}</Button>}
      <BabysitterTimesheetPdfActions doc={doc} scopeKey={`${scopeKey}:${sheet?.id ?? "loading"}`} statusKey={statuses.join(",")} disabled={!statusRevalidated || !doc?.caregiverName} />
    </TimesheetSummaryCard>
    {sheet && <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><p className="text-[13px] font-medium text-muted-foreground">Confirmed</p><p className="text-[28px] font-bold leading-none tabular-nums">{confirmed}</p></div>
      <div className="space-y-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><p className="text-[13px] font-medium text-muted-foreground">Needs confirmation</p><p className="text-[28px] font-bold leading-none tabular-nums text-warning-foreground">{needs}</p></div>
    </div>}
  </>;
}

function groupEntries(entries: TimesheetEntry[]) {
  const weeks = new Map<string, TimesheetEntry[]>();
  for (const e of [...entries].sort((a, b) => a.work_date.localeCompare(b.work_date) || Date.parse(a.actual_start) - Date.parse(b.actual_start))) {
    const week = format(startOfWeek(new Date(`${e.work_date}T12:00:00`), { weekStartsOn: 1 }), "yyyy-MM-dd");
    weeks.set(week, [...(weeks.get(week) ?? []), e]);
  }
  return [...weeks];
}

/** Future previews remain read-only and keep the household's configured period. */
function UpcomingBody({ sheet, now }: { sheet: TimesheetView; now: number }) {
  return <>{groupEntries(sheet.entries).map(([week, entries]) => <section key={week} className="space-y-2">
    <h3 className="px-1 text-[13px] font-semibold uppercase text-muted-foreground">Week of {fmtDate(week)}</h3>
    <ul className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">{entries.map(e => <EntryCard key={e.id} entry={e} sheet={sheet} now={now} editable={false} hours={hoursBetween(e.scheduled_start, e.scheduled_end)} onPreview={() => {}} onSaved={() => {}} />)}</ul>
  </section>)}{!sheet.entries.length && <p className="p-4 text-sm text-muted-foreground">No shifts scheduled for this pay period.</p>}</>;
}

function SheetBody({ sheet, statusRevalidated, preview, setPreview, now }: { sheet: TimesheetView; statusRevalidated: boolean; preview: Record<string, number>; setPreview: Dispatch<SetStateAction<Record<string, number>>>; now: number }) {
  const qc = useQueryClient();
  const resolveConflict = useServerFn(resolveShiftConflict);
  const [adding, setAdding] = useState(() => !!readTimesheetDraft(draftKey(sheet.id, null)));
  // Display-only hours while an editor is open or a save is refreshing; server stays authoritative.
  const setPreviewFor = (key: string, hours: number | null) =>
    setPreview((p) => {
      const next = { ...p };
      if (hours === null) delete next[key];
      else next[key] = hours;
      return next;
    });
  const editable = statusRevalidated && (sheet.status === "draft" || sheet.status === "needs_correction") && !sheet.before_start && !sheet.read_only;
  const hoursFor = (e: TimesheetEntry) => preview[e.id] ?? hoursBetween(e.actual_start, e.actual_end);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["my-timesheet"] });
    void qc.invalidateQueries({ queryKey: MY_TIMESHEET_ACTIONS_KEY });
  };
  return (
    <>
      {sheet.read_only ? (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Timesheets are turned off by your family. Past time cards are kept for your records.
        </p>
      ) : null}
      {sheet.before_start ? (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          This pay period is before your Timesheet start date.
        </p>
      ) : null}
      {sheet.status === "closed" ? (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          This timesheet was closed by the household. It's kept for your records.
        </p>
      ) : null}
      {sheet.status === "needs_correction" ? (
        <div role="alert" className="rounded-2xl border-2 border-destructive bg-destructive/10 p-4 text-sm">
          <p className="font-bold text-destructive">Correction requested</p>
          {sheet.parent_note ? <p className="mt-1 whitespace-pre-wrap">{sheet.parent_note}</p> : null}
        </div>
      ) : null}
      <TimesheetConflicts
        entries={sheet.entries}
        onResolve={editable ? async (entry_id, action) => {
          await resolveConflict({ data: { timesheet_id: sheet.id, entry_id, action } });
          await refresh();
        } : undefined}
      />

      {groupEntries(sheet.entries).map(([week, entries]) => <section key={week} className="space-y-2">
        <h3 className="px-1 text-[13px] font-semibold uppercase text-muted-foreground">Week of {fmtDate(week)}</h3>
        <ul className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">{entries.map(e => <EntryCard key={e.id} entry={e} sheet={sheet} now={now} editable={editable} hours={hoursFor(e)} onPreview={h => setPreviewFor(e.id, h)} onSaved={async () => { await refresh(); setPreviewFor(e.id, null); }} />)}</ul>
      </section>)}
      {!sheet.entries.length && <p className="p-4 text-sm text-muted-foreground">No shifts in this pay period.</p>}

      {editable ? (
        <div className="space-y-3">
          {adding ? (
            <EntryEditor
              sheet={sheet}
              onPreview={(h) => setPreviewFor("new", h)}
              onDone={async () => { setAdding(false); await refresh(); setPreviewFor("new", null); }}
              onCancel={() => { setAdding(false); setPreviewFor("new", null); }}
            />
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add missing shift
            </Button>
          )}

        </div>
      ) : null}
    </>
  );
}

function EntryCard({
  now,
  entry,
  sheet,
  editable,
  hours,
  onPreview,
  onSaved,
}: {
  now: number;
  entry: TimesheetEntry;
  sheet: TimesheetView;
  editable: boolean;
  hours: number;
  onPreview: (hours: number | null) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(() => !!readTimesheetDraft(draftKey(sheet.id, entry.id)));
  const remove = useServerFn(deleteManualEntry);
  const navigate = useNavigate();
  const tz = sheet.time_zone;
  // Tap a date to review that day in Calendar's Day view. The tapped date is
  // written as the scoped session anchor before navigating, so it takes
  // precedence over any previously saved Calendar date.
  const openInCalendar = () => {
    const [y = 0, m = 1, d = 1] = entry.work_date.split("-").map(Number);
    writeCalendarAnchor(new Date(y, m - 1, d, 12));
    requestCalendarDayView();
    void navigate({ to: "/calendar" });
  };
  const status = householdShiftStatus(entry, sheet, now);
  return <li>
    <Button variant="ghost" className="flex h-auto min-h-14 w-full items-center justify-start gap-2 whitespace-normal rounded-none px-3 py-2.5 text-left hover:bg-surface-muted sm:gap-3 sm:px-4" onClick={() => { if (editable) setEditing(true); else openInCalendar(); }}>
      <span className="w-10 shrink-0 text-center"><span className="block text-[11px] font-semibold uppercase text-muted-foreground">{fmtDate(entry.work_date, { weekday: "short" })}</span><span className="block text-lg font-bold">{fmtDate(entry.work_date, { day: "numeric" })}</span></span>
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold tabular-nums">{fmtTime(entry.actual_start, tz)} – {fmtTime(entry.actual_end, tz)}</span>
        {status === "adjusted" && entry.scheduled_start && <span className="block text-xs tabular-nums text-muted-foreground">Scheduled {fmtTime(entry.scheduled_start, tz)} – {fmtTime(entry.scheduled_end, tz)}</span>}
        {entry.note && <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">{entry.note}</span>}
      </span>
      <span className="w-16 shrink-0 text-right text-[15px] font-semibold tabular-nums">{Number(hours.toFixed(2))} hrs</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Button>
    <Dialog open={editing && editable} onOpenChange={open => { if (!open) { setEditing(false); onPreview(null); } }}>
      <DialogContent mobileViewportSafe className="overflow-y-auto sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}><DialogHeader><DialogTitle>Edit hours</DialogTitle><DialogDescription>Times are in {tz}.</DialogDescription></DialogHeader>
        {editing && editable && <EntryEditor sheet={sheet} entry={entry} hours={hours} onPreview={onPreview} onDone={() => { setEditing(false); void onSaved(); }} onCancel={() => { setEditing(false); onPreview(null); }} />}
        {entry.is_manual && editable && <Button variant="ghost" className="w-full text-destructive" onClick={async () => {
          try { await remove({ data: { timesheet_id: sheet.id, entry_id: entry.id } }); clearTimesheetDraft(draftKey(sheet.id, entry.id)); setEditing(false); onPreview(null); void onSaved(); }
          catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
        }}><Trash2 className="size-4" />Remove entry</Button>}
      </DialogContent>
    </Dialog>
  </li>;
}

function EntryEditor({
  sheet,
  entry,
  hours,
  onPreview,
  onDone,
  onCancel,
}: {
  sheet: TimesheetView;
  entry?: TimesheetEntry;
  hours?: number;
  onPreview: (hours: number | null) => void;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const save = useServerFn(saveTimesheetEntry);
  const key = draftKey(sheet.id, entry?.id);
  const [draft] = useState(() => readTimesheetDraft(key));
  const [date, setDate] = useState(draft?.date ?? entry?.work_date ?? sheet.period_start);
  const [start, setStart] = useState(draft?.start ?? entry?.actual_start_local ?? "09:00");
  const [end, setEnd] = useState(draft?.end ?? entry?.actual_end_local ?? "17:00");
  const [note, setNote] = useState(draft?.note ?? entry?.note ?? "");
  const paid = usePaidState(entry, draft?.paid);
  // Session-only draft so a trip to Calendar keeps unsaved values; never saved.
  useEffect(() => {
    writeTimesheetDraft(key, { date, start, end, note, paid: { on: paid.on, hours: paid.hours, note: paid.note } });
  }, [key, date, start, end, note, paid.on, paid.hours, paid.note]);
  const cancel = () => { clearTimesheetDraft(key); onCancel(); };
  const [busy, setBusy] = useState(false);
  const live = localHours(start, end);
  const dirty = !entry || start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "") || paid.dirty;
  useEffect(() => {
    onPreview(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="min-w-0 truncate font-bold">
          {entry ? fmtDate(entry.work_date, { weekday: "short", month: "short", day: "numeric" }) : "Add missing shift"}
        </p>
        <p className="shrink-0 font-semibold">{formatHoursLabel(hours ?? live)}</p>
      </div>
      {entry && !entry.is_manual ? (
        <p className="text-xs text-muted-foreground">
          Scheduled · {fmtTime(entry.scheduled_start, sheet.time_zone)}–{fmtTime(entry.scheduled_end, sheet.time_zone)}
        </p>
      ) : null}
      <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">Actual start</legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <div className="min-w-0 space-y-1"><Label htmlFor={`ts-date-${entry?.id ?? "new"}`} className="text-xs">Date</Label><Input id={`ts-date-${entry?.id ?? "new"}`} type="date" className="block w-full min-w-0 max-w-full appearance-none" readOnly={Boolean(entry)} min={sheet.period_start} max={sheet.period_end} value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="min-w-0 space-y-1"><Label htmlFor={`ts-start-${entry?.id ?? "new"}`} className="text-xs">Time</Label><TimeField id={`ts-start-${entry?.id ?? "new"}`} value={start} onChange={setStart} /></div>
        </div>
      </fieldset>
      <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">Actual end</legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <div className="min-w-0 space-y-1"><Label htmlFor={`ts-end-date-${entry?.id ?? "new"}`} className="text-xs">Date</Label><Input id={`ts-end-date-${entry?.id ?? "new"}`} type="date" className="block w-full min-w-0 max-w-full appearance-none" readOnly value={date && end <= start ? addDaysKey(date, 1) : date} /></div>
          <div className="min-w-0 space-y-1"><Label htmlFor={`ts-end-${entry?.id ?? "new"}`} className="text-xs">Time</Label><TimeField id={`ts-end-${entry?.id ?? "new"}`} value={end} onChange={setEnd} /></div>
        </div>
      </fieldset>
      <p className="text-sm font-semibold">Actual hours · {formatHoursLabel(live)}</p>
      <div className="space-y-1">
        <Label htmlFor={`ts-note-${entry?.id ?? "new"}`} className="text-xs">Add note (optional)</Label>
        <Input id={`ts-note-${entry?.id ?? "new"}`} className="w-full" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      <TimesheetPaidFields id={entry?.id ?? "new"} state={paid} maxHours={live} />
      <p className="text-xs text-muted-foreground">An end time before the start counts as overnight.</p>
      <div className={entry && !dirty ? "" : "grid grid-cols-2 gap-2"}>
        <Button variant="outline" className={entry && !dirty ? "w-full" : undefined} onClick={cancel} disabled={busy}>Cancel</Button>
        {!entry || dirty ? <Button
          disabled={busy || !dirty || !start || !end || !date || !paid.valid(live)}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ data: { timesheet_id: sheet.id, entry_id: entry?.id ?? null, work_date: date, start, end, note: note || null, ...paid.payload() } });
              clearTimesheetDraft(key);
              await onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          {entry ? "Save changes" : "Add shift"}
        </Button> : null}
      </div>
    </div>
  );
}
