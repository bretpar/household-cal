import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { FREQUENCY_LABEL, payPeriodFor, type PaySettings } from "@/lib/timesheet-periods";
import { workDate } from "@/lib/caregiver-timezone";
import { saveCaregiverTimesheetSchedule } from "@/lib/independent-caregiver.functions";

export function CaregiverTimesheetSchedule({ settings, timezone, reload }: { settings: PaySettings; timezone: string; reload: () => Promise<unknown> }) {
  const save = useServerFn(saveCaregiverTimesheetSchedule);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(() => format(workDate(Date.now(), timezone), "yyyy-MM-dd"));
  useEffect(() => { const timer = window.setInterval(() => setToday(format(workDate(Date.now(), timezone), "yyyy-MM-dd")), 60000); return () => clearInterval(timer); }, [timezone]);
  const current = payPeriodFor(editing ? value : settings, today);
  const next = payPeriodFor(editing ? value : settings, today, 1);
  const label = (key: string) => format(new Date(`${key}T12:00:00`), "MMM d, yyyy");
  return <section className="space-y-3 border-t border-border-soft pt-5">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Timesheet schedule</h2>{!editing && <Button size="sm" variant="ghost" onClick={() => { setValue(settings); setEditing(true); }}>Change schedule</Button>}</div>
    {!editing ? <p className="text-sm font-semibold">{FREQUENCY_LABEL[settings.frequency]}</p> : <>
      <Label htmlFor="caregiver-frequency">Frequency</Label><Select value={value.frequency} onValueChange={frequency => setValue({ ...value, frequency: frequency as PaySettings["frequency"] })}><SelectTrigger id="caregiver-frequency" disabled={busy}><SelectValue /></SelectTrigger><SelectContent>{(["weekly", "biweekly", "monthly"] as const).map(f => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}</SelectContent></Select>
      {value.frequency !== "monthly" ? <div className="space-y-1"><Label htmlFor="caregiver-anchor">First day of a known timesheet period</Label><Input id="caregiver-anchor" type="date" value={value.anchor_date} disabled={busy} onChange={e => setValue({ ...value, anchor_date: e.target.value })} /><p className="text-xs text-muted-foreground">Choose a date when one of your timesheet periods began. We'll calculate the repeating schedule automatically.</p></div> : <p className="text-xs text-muted-foreground">Periods run from the first through the last day of each month.</p>}
    </>}
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Current period</dt><dd>{label(current.start)} – {label(current.end)}</dd><dt className="text-muted-foreground">Next period</dt><dd>{label(next.start)} – {label(next.end)}</dd></dl>
    <p className="text-xs text-muted-foreground">Uses your work time zone ({timezone}). Saved adjustments remain on their original work dates.</p>
    {editing && <div className="flex gap-2"><Button size="sm" disabled={busy || !value.anchor_date} onClick={async () => { if (value.frequency === "semimonthly") return; setBusy(true); try { await save({ data: { frequency: value.frequency, anchor_date: value.anchor_date } }); await reload(); setEditing(false); toast.success("Timesheet schedule saved", { duration: 2000 }); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save schedule"); } finally { setBusy(false); } }}>Save Changes</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>}
  </section>;
}