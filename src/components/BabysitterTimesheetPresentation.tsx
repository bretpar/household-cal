import type { ReactNode } from "react";
import { CheckCircle2, Clock3, CircleAlert, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeField } from "@/components/TimeField";
import { TIMESHEET_STATUS_LABELS, type TimesheetRowStatus } from "@/lib/caregiver-timesheet";

export const summaryAction = "min-h-11 w-full rounded-full bg-primary-foreground text-primary font-semibold hover:bg-primary-foreground/90";
export const summarySecondaryAction = "min-h-11 w-full gap-1 rounded-full bg-primary-foreground/15 px-2 text-xs text-primary-foreground font-semibold hover:bg-primary-foreground/25 sm:gap-2 sm:text-sm";

export function compactPeriod(start: string, end: string) {
  const date = (key: string, month: boolean) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...(month ? { month: "short" as const } : {}), day: "numeric", timeZone: "UTC" });
  return `${date(start, true)}–${date(end, start.slice(0, 7) !== end.slice(0, 7))}`;
}

export function TimesheetSummaryCard({ familyName, families, familyId, onFamilyChange, period, previous, next, nextDisabled, current, loading, children }: {
  familyName: string; families?: { id: string; name: string }[]; familyId?: string; onFamilyChange?: (id: string) => void;
  period: string; previous: () => void; next: () => void; nextDisabled?: boolean; current?: (() => void) | undefined; loading?: boolean; children: ReactNode;
}) {
  return <div className="bg-summary space-y-3 overflow-hidden rounded-3xl p-4 text-primary-foreground sm:p-6" aria-busy={loading}>
    <header className="grid grid-cols-1 items-start gap-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
      <div className="min-w-0">
        {families && families.length > 1 && onFamilyChange ? <Select value={familyId ?? ""} onValueChange={onFamilyChange}>
          <SelectTrigger aria-label="Family" className="h-auto min-h-11 w-auto max-w-full min-w-0 justify-start gap-1.5 border-0 bg-transparent px-0 text-left text-lg font-bold shadow-none [&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:break-words [&>svg]:shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>{families.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
        </Select> : <h2 className="break-words pt-2 text-lg font-bold leading-tight sm:text-[22px]">{familyName}</h2>}
      </div>
      <div className="min-w-0 justify-self-start text-right sm:justify-self-end">
        <div className="grid grid-cols-[2.75rem_auto_2.75rem] items-center">
          <Button variant="ghost" size="icon" className="size-11 hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Previous period" onClick={previous}><ChevronLeft className="size-4" /></Button>
          <span className="text-xs font-semibold tabular-nums sm:text-sm">{period || "Loading…"}</span>
          <Button variant="ghost" size="icon" className="size-11 hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Next period" onClick={next} disabled={nextDisabled}><ChevronRight className="size-4" /></Button>
        </div>
        {current && <Button variant="ghost" size="sm" onClick={current} className="h-7 px-2 text-xs text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground">Current period</Button>}
      </div>
    </header>
    {loading ? <div role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm"><span className="size-2 animate-pulse rounded-full bg-primary-foreground motion-reduce:animate-none" />Loading timesheet…</div> : children}
  </div>;
}

export function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl bg-primary-foreground/10 px-2.5 py-3 sm:px-3"><dt className="text-xs font-medium opacity-80">{label}</dt><dd className="mt-1 break-words text-lg font-bold leading-tight tabular-nums sm:text-xl">{value}</dd></div>;
}

const statusStyle = {
  confirmed: { icon: CheckCircle2, tone: "text-success" }, adjusted: { icon: Pencil, tone: "text-primary" },
  unconfirmed: { icon: CircleAlert, tone: "text-warning-foreground" }, future: { icon: Clock3, tone: "text-muted-foreground" },
};
export function ShiftStatus({ status }: { status: TimesheetRowStatus }) {
  const { icon: Icon, tone } = statusStyle[status];
  return <span className={`mt-1 flex items-center gap-1 text-xs font-medium ${tone}`}><Icon className="size-3 shrink-0" aria-hidden />{TIMESHEET_STATUS_LABELS[status]}</span>;
}

export function ActualDateTimeFields({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const [date = "", time = ""] = value.split("T");
  return <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">{label}</legend>
    <div className="grid min-w-0 grid-cols-1 gap-2 min-[380px]:grid-cols-2">
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-date`} className="text-xs">Date</Label><Input id={`${id}-date`} type="date" required className="block w-full min-w-0 max-w-full appearance-none" value={date} onChange={e => onChange(`${e.target.value}T${time}`)} /></div>
      <div className="min-w-0 space-y-1"><Label htmlFor={`${id}-time`} className="text-xs">Time</Label><TimeField id={`${id}-time`} value={time} onChange={t => onChange(`${date}T${t}`)} /></div>
    </div>
  </fieldset>;
}