import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Download, Mail, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCaregiverTimesheet, saveCaregiverActual } from "@/lib/independent-caregiver.functions";
import { buildTimesheetRows, formatHoursValue, timesheetTotals, type TimesheetRow } from "@/lib/caregiver-timesheet";
import { buildTimesheetPdf, pdfFileName, rangeLabel, timesheetSummary, type TimesheetDoc } from "@/lib/caregiver-timesheet-pdf";
import { workDate, workInput, workInputInstant } from "@/lib/caregiver-timezone";
import type { CaregiverClient, WorkShift } from "@/lib/independent-caregiver";
import { cn } from "@/lib/utils";
import { canShareNativeFile, shareNativePdf } from "@/lib/native-file-share";

export function CaregiverTimesheets({ userId, clients, timezone }: { userId: string; clients: CaregiverClient[]; timezone: string }) {
  const load = useServerFn(getCaregiverTimesheet);
  const save = useServerFn(saveCaregiverActual);
  const [clientId, setClientId] = useState(() => clients.find(c => !c.archived)?.id ?? clients[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(workDate(Date.now(), timezone), { weekStartsOn: 1 }));
  const [editing, setEditing] = useState<{ row: TimesheetRow; start: string; end: string; note: string } | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!clients.some(c => c.id === clientId)) setClientId(clients.find(c => !c.archived)?.id ?? ""); }, [clients, clientId]);
  const weekEnd = addDays(weekStart, 7);
  const sheet = useQuery({ queryKey: ["caregiver-timesheet", userId, clientId, weekStart.toISOString()], enabled: Boolean(clientId),
    queryFn: () => load({ data: { client_id: clientId, from: weekStart.toISOString(), to: weekEnd.toISOString() } }) });
  const rows = sheet.data ? buildTimesheetRows(sheet.data.shifts as WorkShift[], sheet.data.actuals, weekStart, weekEnd, timezone) : [];
  const totals = timesheetTotals(rows);
  const doc: TimesheetDoc | null = sheet.data ? { caregiverName: sheet.data.caregiverName, familyName: sheet.data.client.name, from: weekStart, to: weekEnd, timezone, rows } : null;
  const time = (iso: string) => formatInTimeZone(iso, timezone, "h:mm a");
  const persist = async (row: TimesheetRow, actual_start: string, actual_end: string, confirmed: boolean, note: string | null) => {
    setBusy(true);
    try { await save({ data: { shift_id: row.shift.id, actual_start, actual_end, confirmed, note } }); await sheet.refetch(); toast.success(confirmed ? "Hours confirmed" : "Marked unconfirmed", { duration: 2000 }); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save hours"); return false; }
    finally { setBusy(false); }
  };
  const download = async () => { if (!doc) return; (await buildTimesheetPdf(doc)).save(pdfFileName(doc)); };
  const [native, setNative] = useState(false);
  useEffect(() => setNative(canShareNativeFile()), []);
  const shareNative = async () => {
    if (!doc) return;
    try { const pdf = await buildTimesheetPdf(doc); const b64 = pdf.output("datauristring").split(",")[1];
      await shareNativePdf(b64, pdfFileName(doc), `Timesheet: ${doc.familyName}, ${rangeLabel(doc)}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not share the PDF"); }
  };
  if (!clients.length) return <p className="text-muted-foreground">Add a family contact in Settings to start a timesheet.</p>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={clientId} onValueChange={setClientId}><SelectTrigger className="w-56" aria-label="Family"><SelectValue placeholder="Choose family" /></SelectTrigger>
        <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.archived ? " (archived)" : ""}</SelectItem>)}</SelectContent></Select>
      <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="size-4" /></Button>
        <h2 className="text-base font-bold">{doc ? rangeLabel(doc) : formatInTimeZone(weekStart, timezone, "MMM d, yyyy")}</h2>
        <Button size="icon" variant="ghost" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="size-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(workDate(Date.now(), timezone), { weekStartsOn: 1 }))}>This week</Button></div>
    </div>
    {sheet.isError ? <div role="alert" className="space-y-2"><p className="text-destructive">Could not load this timesheet.</p><Button variant="outline" onClick={() => void sheet.refetch()}>Try again</Button></div>
      : !sheet.data ? <p className="text-muted-foreground">Loading timesheet…</p> : <>
      <div className="flex flex-wrap gap-6"><div><p className="text-xs font-bold uppercase text-muted-foreground">Scheduled</p><p className="text-2xl font-bold">{formatHoursValue(totals.scheduled)} h</p></div>
        <div><p className="text-xs font-bold uppercase text-muted-foreground">Confirmed actual</p><p className="text-2xl font-bold">{formatHoursValue(totals.confirmed)} h</p></div>
        {totals.unconfirmed > 0 && <p className="self-end text-sm text-muted-foreground">{totals.unconfirmed} not confirmed yet</p>}</div>
      <div className="divide-y divide-border-soft rounded-2xl border border-border-soft bg-surface">
        {rows.length ? rows.map(r => <div key={r.shift.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0"><p className="font-semibold">{formatInTimeZone(r.scheduledStart, timezone, "EEE, MMM d")}</p>
            <p className="text-sm text-muted-foreground">{r.removed ? "Removed from calendar" : `Scheduled ${time(r.scheduledStart)} – ${time(r.scheduledEnd)}`}</p>
            <p className={cn("text-sm", r.confirmed ? "font-medium" : "italic text-muted-foreground")}>{r.confirmed ? `Actual ${time(r.actualStart)} – ${time(r.actualEnd)} · ${formatHoursValue(r.actualHours)} h` : "Unconfirmed · showing scheduled time"}</p>
            {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}</div>
          {!r.removed && <div className="flex gap-1">
            {!r.confirmed && <Button size="sm" disabled={busy} onClick={() => void persist(r, r.scheduledStart, r.scheduledEnd, true, r.note)}>Confirm</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ row: r, start: workInput(r.actualStart, timezone), end: workInput(r.actualEnd, timezone), note: r.note ?? "" })}>Adjust</Button>
            {r.confirmed && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void persist(r, r.actualStart, r.actualEnd, false, r.note)}>Unconfirm</Button>}
          </div>}
        </div>) : <p className="p-4 text-sm text-muted-foreground">No shifts for this family this week.</p>}
      </div>
      {native ? <div className="space-y-1"><Button variant="outline" onClick={() => void shareNative()}><Share className="size-4" />Share PDF</Button>
        <p className="text-xs text-muted-foreground">Send the PDF by Mail, Messages or AirDrop, or save it to Files.</p></div>
      : <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void download()}><Download className="size-4" />Download PDF</Button>
        <Button variant="outline" onClick={() => setSharing(sheet.data?.client.email ?? "")}><Mail className="size-4" />Prepare email</Button></div>}
    </>}
    <Dialog open={Boolean(editing)} onOpenChange={o => { if (!o && !busy) setEditing(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Actual hours</DialogTitle><DialogDescription>Times are in {timezone}. Saving confirms these hours.</DialogDescription></DialogHeader>
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
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save and confirm"}</Button>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={sharing !== null} onOpenChange={o => { if (!o) setSharing(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Email timesheet</DialogTitle><DialogDescription>We'll download the PDF and open an email draft with a summary. Attach the downloaded PDF before sending.</DialogDescription></DialogHeader>
      {sharing !== null && doc && <form className="space-y-4" onSubmit={async e => { e.preventDefault();
        await download();
        window.location.href = `mailto:${encodeURIComponent(sharing.trim())}?subject=${encodeURIComponent(`Timesheet: ${doc.familyName}, ${rangeLabel(doc)}`)}&body=${encodeURIComponent(timesheetSummary(doc))}`;
        setSharing(null); }}>
        <div className="space-y-1"><Label htmlFor="share-email">Send to</Label><Input id="share-email" type="email" required value={sharing} onChange={e => setSharing(e.target.value)} /></div>
        <Button type="submit" className="w-full">Download PDF and open email</Button>
      </form>}
    </DialogContent></Dialog>
  </section>;
}
