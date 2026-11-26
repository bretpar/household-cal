import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActualDateTimeFields, compactPeriod, ShiftStatus, SummaryStat, TimesheetSummaryCard } from "@/components/BabysitterTimesheetPresentation";
import { BabysitterTimesheetPdfActions } from "@/components/BabysitterTimesheetPdfActions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCaregiverTimesheet, saveCaregiverActual } from "@/lib/independent-caregiver.functions";
import { buildTimesheetRows, formatHoursValue, sortTimesheetRows, timesheetTotals, timesheetRowStatus, type TimesheetRow } from "@/lib/caregiver-timesheet";
import { type TimesheetDoc } from "@/lib/caregiver-timesheet-pdf";
import { workDate, workInput, workInputInstant } from "@/lib/caregiver-timezone";
import type { CaregiverClient, WorkShift } from "@/lib/independent-caregiver";
import { cn } from "@/lib/utils";
import { addDaysKey, payPeriodFor, type PaySettings } from "@/lib/timesheet-periods";

export function CaregiverTimesheets({ userId, clients, timezone, settings }: { userId: string; clients: CaregiverClient[]; timezone: string; settings: PaySettings }) {
  const load = useServerFn(getCaregiverTimesheet);
  const save = useServerFn(saveCaregiverActual);
  const [clientId, setClientId] = useState(() => clients.find(c => !c.archived)?.id ?? clients[0]?.id ?? "");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const today = format(workDate(now, timezone), "yyyy-MM-dd");
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const period = payPeriodFor(settings, today, periodOffset);
  const weekStart = new Date(workInputInstant(`${period.start}T00:00`, timezone));
  const [editing, setEditing] = useState<{ row: TimesheetRow; start: string; end: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!clients.some(c => c.id === clientId)) setClientId(clients.find(c => !c.archived)?.id ?? ""); }, [clients, clientId]);
  const weekEnd = new Date(workInputInstant(`${addDaysKey(period.end, 1)}T00:00`, timezone));
  const sheet = useQuery({ queryKey: ["caregiver-timesheet", userId, clientId, weekStart.toISOString(), weekEnd.toISOString()], enabled: Boolean(clientId),
    queryFn: () => load({ data: { client_id: clientId, from: weekStart.toISOString(), to: weekEnd.toISOString() } }) });
  const fromIso = weekStart.toISOString();
  const toIso = weekEnd.toISOString();
  const rows = useMemo(() => sheet.data ? sortTimesheetRows(buildTimesheetRows(sheet.data.shifts as WorkShift[], sheet.data.actuals, new Date(fromIso), new Date(toIso), timezone)) : [], [sheet.data, fromIso, toIso, timezone]);
  const totals = timesheetTotals(rows);
  // Identity is stable across local UI updates, but never across users, families or periods.
  const doc: TimesheetDoc | null = useMemo(() => sheet.data ? { caregiverName: sheet.data.caregiverName, familyName: sheet.data.client.name, from: new Date(fromIso), to: new Date(toIso), timezone, rows } : null, [sheet.data, userId, clientId, fromIso, toIso, timezone, rows]);
  const rowStatus = (r: TimesheetRow) => timesheetRowStatus(r, now);
  const statusKey = rows.map(rowStatus).join(",");
  const confirmedCount = rows.filter(r => r.confirmed).length;
  const needsCount = rows.filter(r => rowStatus(r) === "unconfirmed").length;
  const futureCount = rows.filter(r => rowStatus(r) === "future").length;
  const diff = totals.effective - totals.scheduled;
  const weeks: { key: string; rows: TimesheetRow[] }[] = [];
  for (const r of rows) { const key = format(startOfWeek(new Date(`${r.workDate}T12:00:00`), { weekStartsOn: 1 }), "yyyy-MM-dd"); const last = weeks[weeks.length - 1];
    if (last?.key === key) last.rows.push(r); else weeks.push({ key, rows: [r] }); }
  const time = (iso: string) => formatInTimeZone(iso, timezone, "h:mm a");
  const persist = async (row: TimesheetRow, actual_start: string, actual_end: string, confirmed: boolean, note: string | null) => {
    if (busy) return false;
    setBusy(true);
    try { await save({ data: { shift_id: row.shift.id, actual_start, actual_end, confirmed, note } }); await sheet.refetch(); toast.success(confirmed ? "Hours saved" : "Reset to scheduled hours", { duration: 2000 }); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save hours"); return false; }
    finally { setBusy(false); }
  };
  if (!clients.length) return <p className="text-muted-foreground">Add a family contact in Settings to start a timesheet.</p>;
  return <section className="min-w-0 space-y-4 pb-4 md:pb-0">
    <TimesheetSummaryCard familyName={clients.find(c => c.id === clientId)?.name ?? "Family"} families={clients} familyId={clientId} onFamilyChange={setClientId}
      period={compactPeriod(period.start, period.end)} previous={() => setPeriodOffset(periodOffset - 1)} next={() => setPeriodOffset(periodOffset + 1)}
      current={periodOffset !== 0 ? () => setPeriodOffset(0) : undefined} loading={!sheet.data}>
      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        <SummaryStat label="Total" value={`${formatHoursValue(totals.effective)} h`} />
        <SummaryStat label="Scheduled" value={`${formatHoursValue(totals.scheduled)} h`} />
        <SummaryStat label="Difference" value={`${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatHoursValue(Math.abs(diff))} h`} />
      </dl>
      {needsCount > 0 || futureCount > 0 ? <p className="text-xs opacity-80">Total uses scheduled hours for shifts that aren't confirmed yet.</p> : null}
      <BabysitterTimesheetPdfActions doc={doc} statusKey={statusKey} scopeKey={`${userId}:${clientId}:${fromIso}:${toIso}`} disabled={sheet.isFetching} email={sheet.data?.client.email ?? ""} />
    </TimesheetSummaryCard>
    {sheet.isError && <div role="alert" className="space-y-2 rounded-2xl border border-border-soft bg-card p-4"><p className="text-destructive">Could not load this timesheet.</p><Button variant="outline" onClick={() => void sheet.refetch()}>Try again</Button></div>}
    {sheet.data && <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-h-[76px] flex-col justify-between gap-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><span className="text-[13px] font-medium text-muted-foreground">Confirmed</span><span className="text-[28px] font-bold leading-none tabular-nums">{confirmedCount}</span></div>
        <div className="flex min-h-[76px] flex-col justify-between gap-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><span className="text-[13px] font-medium text-muted-foreground">Needs confirmation</span><span className={cn("text-[28px] font-bold leading-none tabular-nums", needsCount ? "text-warning-foreground" : "text-muted-foreground")}>{needsCount}</span></div>
      </div>
      {weeks.length ? weeks.map(w => <section key={w.key} className="space-y-2">
        <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Week of {format(new Date(`${w.key}T12:00:00`), "MMM d")}</h3>
        <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
          {w.rows.map(r => { const st = rowStatus(r); const adjusted = st === "adjusted";
            return <Button variant="ghost" key={r.shift.id} type="button" disabled={busy || sheet.isFetching} onClick={() => setEditing({ row: r, start: workInput(r.actualStart, timezone), end: workInput(r.actualEnd, timezone), note: r.note ?? "" })}
              className="flex h-auto min-h-[72px] w-full items-center justify-start gap-2 whitespace-normal rounded-none px-3 py-3 text-left hover:bg-surface-muted active:bg-surface-muted disabled:opacity-70 sm:gap-3 sm:px-4">
              <span className="w-12 shrink-0 text-center"><span className="block text-[11px] font-semibold uppercase text-muted-foreground">{format(new Date(`${r.workDate}T12:00:00`), "EEE")}</span><span className="block text-lg font-bold leading-tight tabular-nums">{format(new Date(`${r.workDate}T12:00:00`), "d")}</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tabular-nums">{time(r.actualStart)} – {time(r.actualEnd)}</span>
                {adjusted && <span className="block break-words text-xs tabular-nums text-muted-foreground">Scheduled {time(r.scheduledStart)} – {time(r.scheduledEnd)}</span>}
                {r.removed && <span className="block break-words text-xs text-muted-foreground">Removed from calendar</span>}
                {r.note && <span className="block break-words text-xs text-muted-foreground">{r.note}</span>}
                <ShiftStatus status={st} />
              </span>
              <span className="w-12 shrink-0 text-right text-[15px] font-semibold tabular-nums">{formatHoursValue(r.actualHours)} h</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Button>; })}
        </div>
      </section>) : <p className="rounded-2xl border border-border-soft bg-card p-4 text-sm text-muted-foreground">No shifts for this family this period.</p>}
    </>}
    <Dialog open={Boolean(editing)} onOpenChange={o => { if (!o && !busy) setEditing(null); }}><DialogContent mobileViewportSafe className="overflow-y-auto sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}><DialogHeader><DialogTitle>Edit hours</DialogTitle><DialogDescription>Times are in {timezone}.</DialogDescription></DialogHeader>
      {editing && <form className="space-y-4" onSubmit={async e => { e.preventDefault();
        try {
          const prior = editing.row.confirmed ? editing.row : null;
          const start = workInputInstant(editing.start, timezone, prior?.actualStart ?? editing.row.scheduledStart);
          const end = workInputInstant(editing.end, timezone, prior?.actualEnd ?? editing.row.scheduledEnd);
          if (await persist(editing.row, start, end, true, editing.note.trim() || null)) setEditing(null);
        } catch (err) { toast.error(err instanceof Error ? err.message : "Check the times"); } }}>
        <p className="text-xs text-muted-foreground">Scheduled · {formatInTimeZone(editing.row.scheduledStart, timezone, "MMM d, h:mm a")} – {formatInTimeZone(editing.row.scheduledEnd, timezone, "MMM d, h:mm a")}</p>
        <ActualDateTimeFields id="actual-start" label="Actual start" value={editing.start} onChange={start => setEditing({ ...editing, start })} />
        <ActualDateTimeFields id="actual-end" label="Actual end" value={editing.end} onChange={end => setEditing({ ...editing, end })} />
        <p className="text-sm font-semibold">Actual hours · {actualPreview(editing.start, editing.end, timezone, editing.row)}</p>
        <div className="space-y-1"><Label htmlFor="actual-note">Note (optional)</Label><Input id="actual-note" maxLength={2000} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} /></div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save hours"}</Button>
        {editing.row.confirmed && <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={async () => { if (await persist(editing.row, editing.row.actualStart, editing.row.actualEnd, false, null)) setEditing(null); }}>Reset to scheduled hours</Button>}
      </form>}
    </DialogContent></Dialog>
  </section>;
}

function actualPreview(start: string, end: string, timezone: string, row: TimesheetRow) {
  try {
    const a = workInputInstant(start, timezone, row.actualStart);
    const b = workInputInstant(end, timezone, row.actualEnd);
    const elapsed = Date.parse(b) - Date.parse(a);
    return elapsed >= 0 ? `${formatHoursValue(elapsed / 3600000)} h` : "Check end date and time";
  } catch { return "—"; }
}
