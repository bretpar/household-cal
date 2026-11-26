import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Download, Mail, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCaregiverTimesheet, saveCaregiverActual } from "@/lib/independent-caregiver.functions";
import { buildTimesheetRows, formatHoursValue, sortTimesheetRows, timesheetTotals, timesheetRowStatus, TIMESHEET_STATUS_LABELS, type TimesheetRow, type TimesheetRowStatus } from "@/lib/caregiver-timesheet";
import { buildTimesheetPdf, pdfFileName, rangeLabel, timesheetSummary, type TimesheetDoc } from "@/lib/caregiver-timesheet-pdf";
import { workDate, workInput, workInputInstant } from "@/lib/caregiver-timezone";
import type { CaregiverClient, WorkShift } from "@/lib/independent-caregiver";
import { cn } from "@/lib/utils";
import { canShareNativeFile, canShareWebFile, shareNativePdf } from "@/lib/native-file-share";
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
  const [sharing, setSharing] = useState<string | null>(null);
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
  const download = async () => { if (!doc) return; (await buildTimesheetPdf(doc)).save(pdfFileName(doc)); };
  const [native, setNative] = useState(false);
  const [webShare, setWebShare] = useState(false);
  useEffect(() => { setNative(canShareNativeFile()); setWebShare(!canShareNativeFile() && canShareWebFile()); }, []);
  const shareTitle = doc ? `Timesheet: ${doc.familyName}, ${rangeLabel(doc)}` : "";
  // Pre-build the PDF so the share sheet opens within the tap (Safari drops the tap after long waits).
  const [ready, setReady] = useState<{ doc: TimesheetDoc; statusKey: string; file: File } | null>(null);
  const preparedFile = ready?.doc === doc && ready.statusKey === statusKey ? ready.file : null;
  useEffect(() => {
    setReady(null);
    if (!webShare || !doc) return;
    let live = true;
    const t = setTimeout(() => { void buildTimesheetPdf(doc).then(pdf => { if (live) setReady({ doc, statusKey, file: new File([pdf.output("blob")], pdfFileName(doc), { type: "application/pdf" }) }); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [webShare, doc, statusKey]);
  const shareNative = async () => {
    if (!doc) return;
    try { const pdf = await buildTimesheetPdf(doc); const b64 = pdf.output("datauristring").split(",")[1] ?? "";
      await shareNativePdf(b64, pdfFileName(doc), shareTitle); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not share the PDF"); }
  };
  const shareWeb = () => {
    if (!doc || !preparedFile) return;
    const failed = (e: unknown) => {
      const name = (e as DOMException)?.name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") { toast("PDF is ready. Tap Share PDF again to open the share sheet."); return; }
      toast.error(e instanceof Error ? e.message : "Could not share the PDF");
    };
    // No generation or await before sharing: retain Safari's tap activation.
    try { void navigator.share({ files: [preparedFile], title: shareTitle, text: timesheetSummary(doc) }).catch(failed); }
    catch (e) { failed(e); }
  };
  if (!clients.length) return <p className="text-muted-foreground">Add a family contact in Settings to start a timesheet.</p>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={clientId} onValueChange={setClientId}><SelectTrigger className="w-56" aria-label="Family"><SelectValue placeholder="Choose family" /></SelectTrigger>
        <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.archived ? " (archived)" : ""}</SelectItem>)}</SelectContent></Select>
      <div className="flex min-w-0 flex-wrap items-center gap-1"><Button size="icon" variant="ghost" aria-label="Previous period" onClick={() => setPeriodOffset(periodOffset - 1)}><ChevronLeft className="size-4" /></Button>
        <h2 className="text-base font-bold">{doc ? rangeLabel(doc) : formatInTimeZone(weekStart, timezone, "MMM d, yyyy")}</h2>
        <Button size="icon" variant="ghost" aria-label="Next period" onClick={() => setPeriodOffset(periodOffset + 1)}><ChevronRight className="size-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setPeriodOffset(0)}>Current period</Button></div>
    </div>
    {sheet.isError ? <div role="alert" className="space-y-2 rounded-2xl border border-border-soft bg-card p-4"><p className="text-destructive">Could not load this timesheet.</p><Button variant="outline" onClick={() => void sheet.refetch()}>Try again</Button></div>
      : !sheet.data ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />Loading timesheet…</p> : <>
      <div className="overflow-hidden rounded-3xl border border-border-soft bg-card">
        <div className="bg-summary space-y-5 p-5 text-primary-foreground sm:p-6">
          <div className="min-w-0"><p className="text-[13px] font-medium opacity-80">{doc ? rangeLabel(doc) : ""}</p>
            <p className="mt-0.5 truncate text-[22px] font-bold leading-tight tracking-tight">{sheet.data.client.name}</p></div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            <SummaryStat label="Timesheet total" value={`${formatHoursValue(totals.effective)} h`} />
            <SummaryStat label="Scheduled" value={`${formatHoursValue(totals.scheduled)} h`} />
            <SummaryStat label="Difference" value={`${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatHoursValue(Math.abs(diff))} h`} />
          </dl>
          {needsCount > 0 || futureCount > 0 ? <p className="text-xs opacity-80">Total uses scheduled hours for shifts that aren't confirmed yet.</p> : null}
          {native ? <div className="space-y-1.5"><button type="button" onClick={() => void shareNative()} className={primaryAction}><Share className="size-4" />Share PDF</button>
            <p className="text-center text-xs opacity-80">Send by Mail, Messages or AirDrop, or save to Files.</p></div>
          : <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void download()} className={primaryAction}><Download className="size-4" />Download PDF</button>
            {webShare ? <Button type="button" variant="ghost" disabled={!preparedFile} onClick={shareWeb} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary-foreground/15 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-50"><Share className="size-4" />Share PDF</Button>
              : <button type="button" onClick={() => setSharing(sheet.data?.client.email ?? "")} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary-foreground/15 text-sm font-semibold transition-transform active:scale-[0.98]"><Mail className="size-4" />Email PDF</button>}
            {webShare && <p className="text-center text-xs opacity-80 sm:col-span-2">Share PDF attaches the file. Choose Mail or another app.</p>}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-h-[76px] flex-col justify-between gap-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><span className="text-[13px] font-medium text-muted-foreground">Confirmed</span><span className="text-[28px] font-bold leading-none tabular-nums">{confirmedCount}</span></div>
        <div className="flex min-h-[76px] flex-col justify-between gap-1 rounded-2xl border border-border-soft bg-card px-4 py-3"><span className="text-[13px] font-medium text-muted-foreground">Needs confirmation</span><span className={cn("text-[28px] font-bold leading-none tabular-nums", needsCount ? "text-warning-foreground" : "text-muted-foreground")}>{needsCount}</span></div>
      </div>
      {weeks.length ? weeks.map(w => <section key={w.key} className="space-y-2">
        <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Week of {format(new Date(`${w.key}T12:00:00`), "MMM d")}</h3>
        <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
          {w.rows.map(r => { const st = rowStatus(r); const adjusted = st === "adjusted";
            return <button key={r.shift.id} type="button" disabled={busy || sheet.isFetching} onClick={() => setEditing({ row: r, start: workInput(r.actualStart, timezone), end: workInput(r.actualEnd, timezone), note: r.note ?? "" })}
              className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-muted disabled:opacity-70">
              <span className="w-12 shrink-0 text-center"><span className="block text-[11px] font-semibold uppercase text-muted-foreground">{format(new Date(`${r.workDate}T12:00:00`), "EEE")}</span><span className="block text-lg font-bold leading-tight tabular-nums">{format(new Date(`${r.workDate}T12:00:00`), "d")}</span></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold tabular-nums">{time(r.actualStart)} – {time(r.actualEnd)}</span>
                {adjusted && <span className="block truncate text-xs tabular-nums text-muted-foreground">Scheduled {time(r.scheduledStart)} – {time(r.scheduledEnd)}</span>}
                {r.removed && <span className="block truncate text-xs text-muted-foreground">Removed from calendar</span>}
                {r.note && <span className="block truncate text-xs text-muted-foreground">{r.note}</span>}
              </span>
              <span className="shrink-0 text-right"><span className="block text-[15px] font-semibold tabular-nums">{formatHoursValue(r.actualHours)} h</span><span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[st].tone)}>{TIMESHEET_STATUS_LABELS[st]}</span></span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>; })}
        </div>
      </section>) : <p className="rounded-2xl border border-border-soft bg-card p-4 text-sm text-muted-foreground">No shifts for this family this period.</p>}
    </>}
    <Dialog open={Boolean(editing)} onOpenChange={o => { if (!o && !busy) setEditing(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Edit hours</DialogTitle><DialogDescription>Times are in {timezone}.</DialogDescription></DialogHeader>
      {editing && <form className="space-y-4" onSubmit={async e => { e.preventDefault();
        try {
          const prior = editing.row.confirmed ? editing.row : null;
          const start = workInputInstant(editing.start, timezone, prior?.actualStart ?? editing.row.scheduledStart);
          const end = workInputInstant(editing.end, timezone, prior?.actualEnd ?? editing.row.scheduledEnd);
          if (await persist(editing.row, start, end, true, editing.note.trim() || null)) setEditing(null);
        } catch (err) { toast.error(err instanceof Error ? err.message : "Check the times"); } }}>
        <div className="space-y-1"><Label htmlFor="actual-start">Actual start</Label><Input id="actual-start" type="datetime-local" required value={editing.start} onChange={e => setEditing({ ...editing, start: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="actual-end">Actual end</Label><Input id="actual-end" type="datetime-local" required value={editing.end} onChange={e => setEditing({ ...editing, end: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="actual-note">Note (optional)</Label><Input id="actual-note" maxLength={2000} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} /></div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save hours"}</Button>
        {editing.row.confirmed && <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={async () => { if (await persist(editing.row, editing.row.actualStart, editing.row.actualEnd, false, null)) setEditing(null); }}>Reset to scheduled hours</Button>}
      </form>}
    </DialogContent></Dialog>
    <Dialog open={sharing !== null} onOpenChange={o => { if (!o) setSharing(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Email PDF</DialogTitle><DialogDescription>Your browser can't attach files to email automatically. We'll download the PDF and open an email draft with a summary. Attach the downloaded PDF to the email before sending.</DialogDescription></DialogHeader>
      {sharing !== null && doc && <form className="space-y-4" onSubmit={async e => { e.preventDefault();
        await download();
        window.location.href = `mailto:${encodeURIComponent(sharing.trim())}?subject=${encodeURIComponent(`Timesheet: ${doc.familyName}, ${rangeLabel(doc)}`)}&body=${encodeURIComponent(timesheetSummary(doc))}`;
        setSharing(null); }}>
        <div className="space-y-1"><Label htmlFor="share-email">Send to</Label><Input id="share-email" type="email" required value={sharing} onChange={e => setSharing(e.target.value)} /></div>
        <Button type="submit" className="w-full">Download PDF and open email</Button>
        <p className="text-xs text-muted-foreground">The PDF is not attached automatically. Look for {doc ? pdfFileName(doc) : "it"} in your Downloads folder.</p>
      </form>}
    </DialogContent></Dialog>
  </section>;
}

const STATUS: Record<TimesheetRowStatus, { tone: string }> = {
  confirmed: { tone: "bg-success/15 text-success" },
  adjusted: { tone: "bg-primary/10 text-primary" },
  unconfirmed: { tone: "bg-warning/20 text-warning-foreground" },
  future: { tone: "bg-secondary text-secondary-foreground" },
};
const primaryAction = "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary-foreground text-sm font-semibold text-primary transition-transform active:scale-[0.98]";
function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl bg-primary-foreground/10 px-3 py-3"><dt className="truncate text-xs font-medium opacity-80">{label}</dt><dd className="mt-0.5 truncate text-lg font-bold leading-tight tabular-nums sm:text-xl">{value}</dd></div>;
}
