import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Plus, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CaregiverSelect } from "@/components/ScheduleBuilder";
import { saveCoverageSettings } from "@/lib/schedule-builder.functions";
import { computeCoverage, toTime, type CoverageSettings, type Suggestion, type DayStatus } from "@/lib/smart-coverage";
import type { Assignment, ExistingShift, Lineage, ScheduleDraft } from "@/lib/schedule-builder";
import type { CalendarEvent, FamilyMember } from "@/lib/family-data";

const statusLabel: Record<DayStatus, string> = { "not-needed": "No overlap", covered: "Fully covered", partial: "Partially covered", missing: "Missing coverage", "no-care": "No childcare needed", review: "Needs manual review" };
const statusClass: Record<DayStatus, string> = { "not-needed": "text-muted-foreground", covered: "text-member-sky-ink", partial: "text-member-amber-ink", missing: "text-destructive", "no-care": "text-muted-foreground", review: "text-member-amber-ink" };
const range = ([a, b]: [number, number]) => `${toTime(a)}–${toTime(b)}`;
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export interface CoverageWorkspace {
  settings: CoverageSettings; sources: { id: string; name: string; provider: string }[];
}
export function SmartCoverageDialog({ familyId, month, timeZone, coverage, events, existing, draft, lineage, caregivers, regularCaregiverId, onClose, onAdd, onDraft, onSettingsSaved }: {
  familyId: string; month: string; timeZone: string; coverage: CoverageWorkspace; events: CalendarEvent[]; existing: ExistingShift[];
  draft: ScheduleDraft; lineage: Lineage; caregivers: FamilyMember[]; regularCaregiverId: string | null;
  onClose: () => void; onAdd: (s: Suggestion, a: Assignment) => void; onDraft: (d: "ignore" | "noCare" | "care", value: string) => void; onSettingsSaved: () => Promise<void>;
}) {
  const save = useServerFn(saveCoverageSettings);
  const s = coverage.settings;
  const [parents, setParents] = useState(s.parents.map(p => ({ label: p.label, sourceId: p.sourceId })));
  const [before, setBefore] = useState(s.bufferBefore); const [after, setAfter] = useState(s.bufferAfter);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const regular = caregivers.find(c => c.id === regularCaregiverId);
  const [assignment, setAssignment] = useState<Assignment>(regular ? { kind: "caregiver", family_member_id: regular.id } : { kind: "none" });
  const settingsDirty = before !== s.bufferBefore || after !== s.bufferAfter || parents.some((p, i) => p.label !== s.parents[i]?.label || p.sourceId !== s.parents[i]?.sourceId);
  const result = useMemo(() => computeCoverage({ month, timeZone, settings: s, draft, existing, lineage,
    workEvents: s.parents.map(p => events.filter(e => !!p.sourceId && e.calendar_source_id === p.sourceId)) as [CalendarEvent[], CalendarEvent[]] }), [month, timeZone, s, draft, existing, lineage, events]);
  const count = (st: DayStatus) => result.days.filter(d => d.status === st).length;
  const attention = result.days.filter(d => d.status !== "not-needed" && d.status !== "covered");
  const assignmentValid = assignment.kind !== "other" || assignment.name.trim().length > 0;
  async function saveSettings() {
    setSaving(true); setError("");
    try { await save({ data: { familyId, parents, bufferBefore: before, bufferAfter: after } }); await onSettingsSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Settings could not be saved."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={o => { if (!o) onClose(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>Check Coverage</DialogTitle>
      <DialogDescription>Scheduling suggestions based on when both parents are working. They don't confirm a caregiver is available. Work calendars are only read, never changed.</DialogDescription></DialogHeader>
    <section className="space-y-3 border-b border-border pb-4">
      <h3 className="text-sm font-semibold">Work calendars</h3>
      <div className="grid grid-cols-2 gap-3">{parents.map((p, i) => <div key={i} className="space-y-1">
        <Input aria-label={`Parent ${i + 1} name`} value={p.label} maxLength={40} onChange={e => setParents(ps => ps.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
        <Select value={p.sourceId ?? "none"} onValueChange={v => setParents(ps => ps.map((x, j) => j === i ? { ...x, sourceId: v === "none" ? null : v } : x))}>
          <SelectTrigger aria-label={`${p.label} work calendar`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">Not chosen</SelectItem>{coverage.sources.map(src => <SelectItem key={src.id} value={src.id}>{src.name}{src.provider === "google" ? " · Google" : src.provider === "ics" ? " · Apple/ICS" : ""}</SelectItem>)}</SelectContent></Select>
      </div>)}</div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">Buffer before (min)<Input type="number" min={0} max={240} step={15} className="w-28" value={before} onChange={e => setBefore(Math.max(0, Math.min(240, Number(e.target.value) || 0)))} /></label>
        <label className="space-y-1">Buffer after (min)<Input type="number" min={0} max={240} step={15} className="w-28" value={after} onChange={e => setAfter(Math.max(0, Math.min(240, Number(e.target.value) || 0)))} /></label>
        <Button variant="outline" disabled={!settingsDirty || saving || parents.some(p => !p.label.trim())} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save & recheck"}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
    {result.problems.length > 0 && <div role="alert" className="flex gap-2 rounded-md border border-member-amber bg-member-amber-soft p-3 text-sm text-member-amber-ink"><AlertTriangle className="h-4 w-4 shrink-0" /><div><p className="font-semibold">Results are incomplete — missing work events don't mean a parent is free.</p>{result.problems.map(p => <p key={p}>{p}</p>)}</div></div>}
    <dl className="grid grid-cols-3 divide-x divide-border border-y border-border py-3">
      {([["Fully covered", count("covered")], ["Partial coverage", count("partial")], ["Missing coverage", count("missing")]] as const).map(([l, v]) => <div key={l} className="px-4 first:pl-0"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>)}
    </dl>
    <div className="flex flex-wrap items-end gap-3"><div className="w-64"><CaregiverSelect value={assignment} onChange={setAssignment} caregivers={caregivers} /></div>
      <p className="pb-2 text-xs text-muted-foreground">Used for shifts you add below. Unassigned shifts don't count as confirmed coverage.</p></div>
    {attention.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{result.complete ? "No coverage gaps found this month." : "Coverage can't be confirmed for this month — see the warning above."}</p> :
    <ul className="divide-y divide-border">{attention.map(d => <li key={d.date} className="space-y-1.5 py-3">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{dayLabel(d.date)} <span className={cn("ml-2 text-xs font-medium", statusClass[d.status])}>{statusLabel[d.status]}</span></p>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={d.status === "no-care"} onCheckedChange={c => onDraft(c === true ? "noCare" : "care", d.date)} />No childcare needed</label></div>
      {d.status !== "no-care" && d.needed.length > 0 && <>
        <p className="text-xs text-muted-foreground">Both working (incl. buffers): {d.needed.map(range).join(", ")} · Uncovered: {d.uncovered.map(range).join(", ")}</p>
        {d.unassignedOnly.length > 0 && <p className="text-xs text-member-amber-ink">Unassigned shift during {d.unassignedOnly.map(range).join(", ")} — assign a caregiver to confirm.</p>}
        {d.suggestions.map(sg => <div key={sg.key} className="flex items-center gap-2 rounded-md border border-member-sage bg-member-sage-soft px-2 py-1 text-member-sage-ink">
          <span className="flex-1 text-xs font-semibold tabular-nums">Suggested shift {sg.start}–{sg.end}</span>
          <Button size="sm" variant="outline" className="h-7" disabled={!assignmentValid} onClick={() => onAdd(sg, assignment)}><Plus className="h-3 w-3" />Add to draft</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onDraft("ignore", sg.key)}><EyeOff className="h-3 w-3" />Ignore</Button></div>)}
      </>}
      {d.ignoredAllDay && <p className="text-xs text-member-amber-ink">All-day work events on this day aren't counted — check them yourself.</p>}
    </li>)}</ul>}
    <p className="text-xs text-muted-foreground">Added shifts stay in your private draft until you save, review and publish.</p>
  </DialogContent></Dialog>;
}
