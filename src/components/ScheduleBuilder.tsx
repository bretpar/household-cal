import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus, Save, Trash2, Pencil, LockKeyhole, Repeat2, Move, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useCalendar } from "@/lib/calendar-store";
import { getVerifiedMembership } from "@/lib/auth-guard";
import { cn } from "@/lib/utils";
import { useScheduleDrag } from "@/hooks/use-schedule-drag";
import { monthDates, shiftMonth, buildTemplate, appendProposals, proposalNeedsReview, existingMonthShifts, draftSchema, templateSchema,
  editSchedule, scheduleSummary, type ScheduleCommand, type Assignment, type ProposedShift, type ScheduleDraft, type ScheduleTemplate, type ExistingShift } from "@/lib/schedule-builder";
import { loadScheduleWorkspace, saveScheduleDraft, saveScheduleTemplate } from "@/lib/schedule-builder.functions";
import type { FamilyMember } from "@/lib/family-data";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fieldClass = "space-y-1 text-sm font-medium";
const labelDate = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

export function ScheduleBuilder() {
  const { family, isOwner } = useCalendar();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { const q = window.matchMedia("(min-width: 1024px)"); const update = () => setDesktop(q.matches); update(); q.addEventListener("change", update); return () => q.removeEventListener("change", update); }, []);
  if (!desktop || !isOwner || !family) return null;
  return <ScheduleWorkspace key={`${getVerifiedMembership()?.userId}:${family.id}`} familyId={family.id} />;
}

function ScheduleWorkspace({ familyId }: { familyId: string }) {
  const load = useServerFn(loadScheduleWorkspace);
  const [month, setMonth] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["schedule-workspace", getVerifiedMembership()?.userId, familyId, month],
    queryFn: () => load({ data: { familyId, month: month ?? new Date().toISOString().slice(0, 7) } }), refetchOnWindowFocus: false });
  // Select the initial month from the household clock, not the device clock.
  useEffect(() => { if (query.data && !month) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: query.data.timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
    setMonth(`${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`);
  } }, [query.data, month]);
  if (query.isError && !query.data) return <div role="alert" className="space-y-3"><p>Schedule could not be loaded.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data || !month) return <p className="py-10 text-muted-foreground">Loading schedule…</p>;
  return <>{query.isError && <div role="alert"><p>Schedule refresh failed. Your local changes are preserved.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>}
    <MonthWorkspace key={`${familyId}:${month}`} familyId={familyId} month={month} data={query.data}
      changeMonth={setMonth} reload={async () => { const result = await query.refetch(); if (result.error) throw result.error; if (!result.data) throw new Error("Schedule could not be loaded."); return result.data; }} /></>;
}
type WorkspaceData = Awaited<ReturnType<typeof loadScheduleWorkspace>>;

function MonthWorkspace({ familyId, month, data, changeMonth, reload }: { familyId: string; month: string; data: WorkspaceData; changeMonth: (m: string) => void; reload: () => Promise<WorkspaceData> }) {
  const save = useServerFn(saveScheduleDraft); const saveTemplate = useServerFn(saveScheduleTemplate);
  const [draft, setDraft] = useState<ScheduleDraft>(data.draft?.content ?? { shifts: [] });
  const [revision, setRevision] = useState(data.draft?.revision ?? 0);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [conflict, setConflict] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false); const [editing, setEditing] = useState<ProposedShift | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const draftRef = useRef(draft); const dirtyRef = useRef(false); const savingRef = useRef(false);
  const acceptSaved = (saved: WorkspaceData) => {
    const content = saved.draft?.content ?? { shifts: [] };
    draftRef.current = content; dirtyRef.current = false;
    setDraft(content); setRevision(saved.draft?.revision ?? 0); setDirty(false); setConflict(false); setMessage("");
  };
  useEffect(() => {
    if (savingRef.current) return;
    if (!dirtyRef.current) acceptSaved(data);
    else if ((data.draft?.revision ?? 0) !== revision) {
      setConflict(true); setMessage("Another Owner saved this month. Your local changes are preserved. Reload the saved draft to discard them.");
    }
  }, [data]);
  const caregivers = data.bundle.members.filter(m => m.active && !m.removed_at && m.role === "caregiver");
  const dates = monthDates(month);
  const existing = useMemo(() => existingMonthShifts(data.bundle.events.filter(e => e.calendar_source_id === data.bundle.family?.babysitter_calendar_source_id), month, data.timeZone, data.lineage), [data, month]);
  const assignmentLabel = (a: Assignment) => a.kind === "caregiver" ? data.bundle.members.find(m => m.id === a.family_member_id)?.name ?? "Former caregiver" : a.kind === "other" ? a.name : "Unassigned";
  const modify = (next: ScheduleDraft) => { draftRef.current = next; dirtyRef.current = true; setDraft(next); setDirty(true); setMessage(""); };
  const command = (action: ScheduleCommand) => {
    try { modify(editSchedule(draftRef.current, month, action)); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Proposal could not be changed."); }
  };
  const moveProposal = (id: string, date: string) => { command({ kind: "move", id, date }); setMoving(null); };
  const drag = useScheduleDrag(moveProposal);
  const selection = selected.filter(id => draft.shifts.some(s => s.id === id));
  const summary = scheduleSummary(draft, existing);
  const toggleSelected = (id: string, checked: boolean) => setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(s => s !== id));
  const leave = (action: () => void) => { if (!savingRef.current && (!dirtyRef.current || window.confirm("Discard unsaved draft changes?"))) action(); };
  useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  async function saveDraft() {
    if (savingRef.current) return;
    savingRef.current = true;
    const submitted = draftRef.current;
    setBusy(true); setMessage("");
    try { const result = await save({ data: { familyId, month, revision, content: submitted } });
      if (result.conflict) { setConflict(true); setMessage("Another Owner saved this month. Your changes have not been overwritten. Reload the saved draft or keep your local changes."); }
      else { setRevision(result.revision); setConflict(false);
        const unchanged = draftRef.current === submitted;
        dirtyRef.current = !unchanged; setDirty(!unchanged);
        setMessage(unchanged ? "Private draft saved." : "Earlier changes saved. Newer edits remain unsaved.");
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Draft could not be saved."); }
    finally { savingRef.current = false; setBusy(false); }
  }
  async function reloadSaved() {
    if (savingRef.current || (dirtyRef.current && !window.confirm("Discard unsaved draft changes?"))) return;
    savingRef.current = true; setBusy(true);
    const snapshot = draftRef.current;
    try { const saved = await reload(); if (draftRef.current === snapshot) { acceptSaved(saved); setEditing(null); setSelected([]); setMoving(null); } }
    catch (e) { setMessage(e instanceof Error ? e.message : "Draft could not be loaded."); }
    finally { savingRef.current = false; setBusy(false); }
  }
  const newShift = (date: string): ProposedShift => ({ id: crypto.randomUUID(), date, start: "09:00", end: "17:00", title: "Babysitter", assignment: { kind: "none" } });
  const editExisting = (s: ExistingShift) => setEditing({ ...newShift(s.date), start: s.start, end: s.end, title: s.title, assignment: s.assignment,
    existing: { eventId: s.eventId, occurrenceKey: s.key, startAt: s.startAt, splitFromEventId: s.splitFromEventId, splitFromDate: s.splitFromDate } });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => leave(() => changeMonth(shiftMonth(month, -1)))}><ChevronLeft /></Button>
        <div className="min-w-52 text-center"><h2 className="text-xl font-bold">{labelDate(`${month}-01`, { month: "long", year: "numeric" })}</h2><p className="text-xs text-muted-foreground">{data.timeZone} · Private draft{dirty ? " · Unsaved" : revision ? ` · Revision ${revision}` : ""}</p></div>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => leave(() => changeMonth(shiftMonth(month, 1)))}><ChevronRight /></Button></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => leave(() => modify({ shifts: [] }))}>Start Blank</Button>
        <Button variant="outline" disabled={busy} onClick={() => setTemplateOpen(true)}>Build from Template</Button>
        <Button disabled={busy || conflict || (!dirty && revision > 0)} onClick={() => void saveDraft()}><Save className="h-4 w-4" />Save Draft</Button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><div className="flex gap-4"><span className="text-member-sky-ink">● Existing</span><span className="text-member-sage-ink">● Proposed</span><span className="text-member-amber-ink">● Modified proposal</span></div><Button variant="outline" disabled><LockKeyhole className="h-4 w-4" />Publish Schedule — Coming Soon</Button></div>
    <dl className="grid grid-cols-4 divide-x divide-border border-y border-border py-3">
      {[["Proposed shifts", summary.proposals], ["Proposed hours", Number(summary.hours.toFixed(2))], ["Existing calendar shifts", summary.existing], ["Template conflicts", summary.conflicts]].map(([label, value]) => <div key={label} className="px-4 first:pl-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-2 flex items-center gap-2 text-sm"><Checkbox aria-label="Select all proposed shifts" checked={selection.length === draft.shifts.length && selection.length > 0 ? true : selection.length > 0 ? "indeterminate" : false} disabled={!draft.shifts.length} onCheckedChange={checked => setSelected(checked === true ? draft.shifts.map(s => s.id) : [])} />{selection.length ? `${selection.length} selected` : "Select proposals"}</label>
      {selection.length > 0 && <><Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>Change caregiver</Button><Button size="sm" variant="outline" onClick={() => { command({ kind: "remove", ids: selection }); setSelected([]); setMoving(null); }}><Trash2 className="h-4 w-4" />Remove selected</Button><Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => setSelected([])}><X className="h-4 w-4" /></Button></>}
      {moving && <Button size="sm" variant="outline" onClick={() => setMoving(null)}><X className="h-4 w-4" />Cancel move</Button>}
    </div>
    {message && <div role="status" className="flex items-center gap-3 text-sm"><p>{message}</p>{conflict && <Button variant="outline" disabled={busy} onClick={() => void reloadSaved()}>Reload saved draft</Button>}</div>}
    {!data.bundle.family?.babysitter_calendar_source_id && <p className="text-sm text-muted-foreground">No Babysitter calendar is selected. Drafts can still be saved.</p>}
    <div className="grid grid-cols-7 border-l border-t border-border">
      {weekdays.map(d => <div key={d} className="border-b border-r border-border bg-surface-muted px-2 py-2 text-xs font-semibold">{d}</div>)}
      {Array.from({ length: new Date(`${month}-01T12:00:00Z`).getUTCDay() }, (_, i) => <div key={`empty-${i}`} className="border-b border-r border-border bg-surface-muted/50" />)}
      {dates.map(date => <div key={date} onDragOver={event => drag.over(event, date)} onDrop={event => drag.drop(event, date)} className={cn("min-h-40 min-w-0 space-y-1.5 border-b border-r border-border p-2", drag.dropDate === date && "bg-accent ring-2 ring-inset ring-ring")}>
        <div className="flex items-center justify-between"><Button variant="ghost" size="sm" className="h-7 px-2" aria-label={moving ? `Move proposal to ${date}` : `Add proposed shift on ${date}`} onClick={() => moving ? moveProposal(moving, date) : setEditing(newShift(date))}>{Number(date.slice(8))}{moving && <Move className="h-3 w-3" />}</Button><Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`New shift on ${date}`} onClick={() => setEditing(newShift(date))}><Plus className="h-3 w-3" /></Button></div>
        {existing.filter(s => s.date <= date && s.endDate >= date).map(s => <article key={s.key} className="rounded-md border border-member-sky bg-member-sky-soft p-2 text-member-sky-ink"><div className="flex items-start justify-between gap-1"><p className="min-w-0 break-words text-xs font-semibold">{s.allDay ? "All day" : s.date !== s.endDate ? `${s.date.slice(5)} ${s.start} – ${s.endDate.slice(5)} ${s.end}` : `${s.start}–${s.end}`}</p><div className="flex shrink-0 items-center gap-1">{s.recurring && <Repeat2 className="h-3 w-3" aria-label="Recurring shift" />}{!s.allDay && s.date === s.endDate && s.date === date && s.start < s.end && !draft.shifts.some(p => p.existing?.occurrenceKey === s.key) && <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Create private change proposal" aria-label={`Propose changes to ${s.title} on ${date}`} onClick={() => editExisting(s)}><Pencil className="h-3 w-3" /></Button>}</div></div><p className="break-words text-xs">{assignmentLabel(s.assignment)}</p><p className="break-words text-xs opacity-80">{s.title}</p></article>)}
        {draft.shifts.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start)).map(s => <article key={s.id} draggable onDragStart={event => drag.start(event, s.id)} onDragEnd={drag.end} className={cn("rounded-md border p-1.5", s.existing || proposalNeedsReview(s, existing) ? "border-member-amber bg-member-amber-soft text-member-amber-ink" : "border-member-sage bg-member-sage-soft text-member-sage-ink", (selection.includes(s.id) || moving === s.id) && "ring-2 ring-ring")}>
          <div className="flex items-start gap-1"><Checkbox className="mt-1 shrink-0" aria-label={`Select proposal ${s.start} on ${date}`} checked={selection.includes(s.id)} onCheckedChange={checked => toggleSelected(s.id, checked === true)} />
            <Button variant="ghost" className="h-auto min-w-0 flex-1 items-start justify-start whitespace-normal px-1 py-0 text-left" aria-label={`Edit proposal ${s.start} on ${date}`} onClick={() => setEditing(s)}><span className="min-w-0"><span className="block text-xs font-semibold tabular-nums">{s.start}–{s.end}</span><span className="block break-words text-xs font-normal">{assignmentLabel(s.assignment)}</span></span></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Move proposal to another date" aria-label={`Move proposal ${s.start} on ${date}`} onClick={() => setMoving(s.id)}><Move className="h-3 w-3" /></Button></div>
          {s.existing && <p className="mt-1 text-xs">Change proposed</p>}{proposalNeedsReview(s, existing) && <p className="mt-1 text-xs">Review: existing shift differs</p>}
        </article>)}
      </div>)}
      {Array.from({ length: (7 - (new Date(`${month}-01T12:00:00Z`).getUTCDay() + dates.length) % 7) % 7 }, (_, i) => <div key={`trailing-${i}`} className="border-b border-r border-border bg-surface-muted/50" />)}
    </div>
    <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} caregivers={caregivers} templates={data.templates}
      onBuild={(t) => { modify(appendProposals(draftRef.current, buildTemplate(month, t, () => crypto.randomUUID()), existing)); setTemplateOpen(false); }}
      onSave={async (name, content) => { await saveTemplate({ data: { familyId, name, content } }); }} />
    {editing && <ShiftDialog key={editing.id} shift={editing} month={month} caregivers={caregivers} onClose={() => setEditing(null)}
      onSave={s => { command({ kind: "keep", shift: s }); setEditing(null); }}
      onRemove={draft.shifts.some(s => s.id === editing.id) ? () => { command({ kind: "remove", ids: [editing.id] }); setEditing(null); } : undefined} />}
    {bulkOpen && <BulkCaregiverDialog count={selection.length} caregivers={caregivers} onClose={() => setBulkOpen(false)} onApply={assignment => { command({ kind: "assign", ids: selection, assignment }); setBulkOpen(false); }} />}
  </div>;
}

function CaregiverSelect({ value, onChange, caregivers }: { value: Assignment; onChange: (a: Assignment) => void; caregivers: FamilyMember[] }) {
  return <div className={fieldClass}><label>Caregiver</label><Select value={value.kind === "caregiver" ? value.family_member_id : value.kind} onValueChange={v => onChange(v === "none" ? { kind: "none" } : v === "other" ? { kind: "other", name: "" } : { kind: "caregiver", family_member_id: v })}><SelectTrigger aria-label="Caregiver"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{caregivers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}<SelectItem value="other">Other</SelectItem></SelectContent></Select>{value.kind === "other" && <Input aria-label="Other caregiver name" placeholder="Caregiver name" maxLength={100} value={value.name} onChange={e => onChange({ kind: "other", name: e.target.value })} />}</div>;
}
function BulkCaregiverDialog({ count, caregivers, onClose, onApply }: { count: number; caregivers: FamilyMember[]; onClose: () => void; onApply: (a: Assignment) => void }) {
  const [assignment, setAssignment] = useState<Assignment>({ kind: "none" });
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Change caregiver · {count} shifts</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); const result = templateSchema.shape.assignment.safeParse(assignment); if (result.success) onApply(result.data); else setError("Enter a caregiver name for Other."); }}><CaregiverSelect value={assignment} onChange={setAssignment} caregivers={caregivers} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!count}>Apply</Button></div></form></DialogContent></Dialog>;
}
function ShiftDialog({ shift, month, caregivers, onClose, onSave, onRemove }: { shift: ProposedShift; month: string; caregivers: FamilyMember[]; onClose: () => void; onSave: (s: ProposedShift) => void; onRemove: (() => void) | undefined }) {
  const [value, setValue] = useState(shift); const [error, setError] = useState("");
  return <Dialog open onOpenChange={v => { if (!v) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{shift.existing ? "Propose a change" : "Proposed shift"}</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); try { const parsed = draftSchema.parse({ shifts: [value] }); const s = parsed.shifts[0]; if (s) onSave(s); } catch { setError("Enter a name, caregiver, and valid same-day start/end times."); } }}><label className={cn(fieldClass, "block")}>Title<Input value={value.title} maxLength={200} onChange={e => setValue({ ...value, title: e.target.value })} required /></label><label className={cn(fieldClass, "block")}>Date<Input type="date" min={`${month}-01`} max={monthDates(month).at(-1)} value={value.date} onChange={e => setValue({ ...value, date: e.target.value })} required /></label><div className="grid grid-cols-2 gap-3">{(["start", "end"] as const).map(k => <label key={k} className={fieldClass}>{k === "start" ? "Start" : "End"}<Input type="time" value={value[k]} onChange={e => setValue({ ...value, [k]: e.target.value })} required /></label>)}</div><CaregiverSelect value={value.assignment} onChange={a => setValue({ ...value, assignment: a })} caregivers={caregivers} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-between gap-2">{onRemove ? <Button type="button" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" />Remove proposal</Button> : <span />}<Button type="submit">Keep proposal</Button></div></form></DialogContent></Dialog>;
}
function TemplateDialog({ open, onOpenChange, caregivers, templates, onBuild, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; caregivers: FamilyMember[]; templates: WorkspaceData["templates"]; onBuild: (t: ScheduleTemplate) => void; onSave: (name: string, t: ScheduleTemplate) => Promise<void> }) {
  const [value, setValue] = useState<ScheduleTemplate>({ assignment: { kind: "none" }, weekdays: [1,2,3,4,5].map(day => ({ day, start: "09:00", end: "17:00" })) });
  const [name, setName] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(templates);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Build from Template</DialogTitle></DialogHeader><div className="space-y-4">
    {saved.length > 0 && <Select onValueChange={id => { const t = saved.find(t => t.id === id); if (t) { setValue(t.content); setName(t.name); } }}><SelectTrigger aria-label="Saved templates"><SelectValue placeholder="Choose a saved template" /></SelectTrigger><SelectContent>{saved.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>}
    <div className="space-y-2">{weekdays.map((day, i) => { const row = value.weekdays.find(w => w.day === i); return <div key={day} className="grid grid-cols-[1fr_110px_110px] items-center gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={!!row} onCheckedChange={checked => setValue({ ...value, weekdays: checked ? [...value.weekdays, { day: i, start: "09:00", end: "17:00" }] : value.weekdays.filter(w => w.day !== i) })} />{day}</label>{(["start", "end"] as const).map(k => <Input key={k} type="time" aria-label={`${day} ${k}`} disabled={!row} value={row?.[k] ?? "09:00"} onChange={e => setValue({ ...value, weekdays: value.weekdays.map(w => w.day === i ? { ...w, [k]: e.target.value } : w) })} />)}</div>; })}</div>
    <CaregiverSelect value={value.assignment} onChange={assignment => setValue({ ...value, assignment })} caregivers={caregivers} />
    <label className={cn(fieldClass, "block")}>Template name<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
    {error && <p role="status" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-between gap-2"><Button variant="outline" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); try { const t = templateSchema.parse(value); await onSave(name, t); setSaved([...saved, { id: `local-${Date.now()}`, name, revision: 1, content: t }]); setError("Template saved."); } catch { setError("Template could not be saved. Check weekdays, times, and caregiver."); } finally { setBusy(false); } }}>Save reusable template</Button><Button disabled={busy} onClick={() => { try { onBuild(templateSchema.parse(value)); setError(""); } catch { setError("Choose weekdays, valid same-day times, and a caregiver name if Other."); } }}>Add proposed shifts</Button></div>
  </div></DialogContent></Dialog>;
}