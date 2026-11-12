import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus, Save, Trash2, LockKeyhole, ShieldCheck, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useCalendar } from "@/lib/calendar-store";
import { getVerifiedMembership } from "@/lib/auth-guard";
import { ScheduleReviewDialog } from "@/components/ScheduleReviewDialog";
import { SmartCoverageDialog } from "@/components/SmartCoverageDialog";
import { suggestionToShift, ignoreSuggestion, setNoCare, parentWorkDays } from "@/lib/smart-coverage";
import { cn } from "@/lib/utils";
import { useScheduleDrag } from "@/hooks/use-schedule-drag";
import { monthDates, shiftMonth, buildTemplate, appendProposals, proposalNeedsReview, proposalOrphaned, convertOrphanToNew, orphanStatus, orphanLabel, existingMonthShifts, draftSchema, templateSchema,
  editSchedule, scheduleSummary, existingToProposal, acceptShiftChange, shiftConfirmed, sameIdentity, type ScheduleCommand, type Assignment, type ProposedShift, type ScheduleDraft, type ScheduleTemplate, type ExistingShift } from "@/lib/schedule-builder";
import { loadScheduleWorkspace, saveScheduleDraft, saveScheduleTemplate } from "@/lib/schedule-builder.functions";
import type { FamilyMember } from "@/lib/family-data";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const compactWorkTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60) % 24, minute = minutes % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "a" : "p"}`;
};
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const draftRef = useRef(draft); const dirtyRef = useRef(false); const savingRef = useRef(false);
  const revisionRef = useRef(revision); const reviewingRef = useRef(false);
  const dragClickUntil = useRef(0);
  const acceptSaved = (saved: WorkspaceData) => {
    const content = saved.draft?.content ?? { shifts: [] };
    draftRef.current = content; dirtyRef.current = false;
    revisionRef.current = saved.draft?.revision ?? 0;
    setDraft(content); setRevision(revisionRef.current); setDirty(false); setConflict(false); setMessage("");
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
  const moveProposal = (id: string, date: string) => {
    const current = draftRef.current;
    const proposal = current.shifts.find(s => s.id === id);
    if (proposal) { command({ kind: "move", id, date }); return; }
    const original = existing.find(s => s.key === id);
    if (!original || original.date === date || current.shifts.some(p => sameIdentity(p, original))) return;
    try { const shift = existingToProposal(original, crypto.randomUUID());
      modify(editSchedule(current, month, { kind: "keep", shift: { ...shift, date } }));
    } catch (e) { setMessage(e instanceof Error ? e.message : "Shift could not be moved."); }
  };
  const drag = useScheduleDrag(moveProposal);
  const selection = selected.filter(id => draft.shifts.some(s => s.id === id));
  const summary = scheduleSummary(draft, existing);
  const workDays = useMemo(() => parentWorkDays(month, data.timeZone, data.coverage.settings, data.bundle.events, data.lineage), [data, month]);
  const versionFor = (s: ProposedShift) => data.bundle.events.find(e => e.id === existing.find(e => sameIdentity(s, e))?.eventId)?.updated_at;
  const acceptChange = (id: string) => {
    const shift = draftRef.current.shifts.find(s => s.id === id);
    if (!shift) return;
    try { modify(acceptShiftChange(draftRef.current, id, existing, versionFor(shift))); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Change could not be accepted."); }
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(s => s !== id));
  const leave = (action: () => void) => { if (!savingRef.current && (!dirtyRef.current || window.confirm("Discard unsaved draft changes?"))) action(); };
  useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  async function saveDraft(forReview = false): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setBusy(true); setMessage("");
    try {
      do {
        const submitted = draftRef.current;
        const result = await save({ data: { familyId, month, revision: revisionRef.current, content: submitted } });
        if (result.conflict) {
          setConflict(true);
          setMessage("Another Owner saved this month. Review wasn't opened. Your changes are preserved; reload the saved draft or keep your local changes.");
          return false;
        }
        revisionRef.current = result.revision;
        setRevision(result.revision); setConflict(false);
        const unchanged = draftRef.current === submitted;
        dirtyRef.current = !unchanged; setDirty(!unchanged);
        setMessage(unchanged ? "Private draft saved." : "Earlier changes saved. Newer edits remain unsaved.");
        // Editing can continue during a save. Review waits for the latest
        // snapshot, using the revision confirmed by the preceding save.
      } while (forReview && dirtyRef.current);
      return !dirtyRef.current;
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Draft could not be saved.";
      setMessage(forReview ? `Review wasn't opened. ${detail} Your unsaved changes are preserved. Try Review Schedule again.` : detail);
      return false;
    } finally { savingRef.current = false; setBusy(false); }
  }
  async function openReview() {
    if (reviewingRef.current || savingRef.current || reviewOpen) return;
    reviewingRef.current = true;
    try {
      if (conflict) { setMessage("Resolve the saved-draft conflict before opening Review. Your changes are preserved."); return; }
      if ((dirtyRef.current || revisionRef.current === 0) && !(await saveDraft(true))) return;
      if (!dirtyRef.current && !savingRef.current) setReviewOpen(true);
    } finally { reviewingRef.current = false; }
  }
  async function reloadSaved() {
    if (savingRef.current || (dirtyRef.current && !window.confirm("Discard unsaved draft changes?"))) return;
    savingRef.current = true; setBusy(true);
    const snapshot = draftRef.current;
    try { const saved = await reload(); if (draftRef.current === snapshot) { acceptSaved(saved); setEditing(null); setSelected([]); } }
    catch (e) { setMessage(e instanceof Error ? e.message : "Draft could not be loaded."); }
    finally { savingRef.current = false; setBusy(false); }
  }
  const newShift = (date: string): ProposedShift => ({ id: crypto.randomUUID(), date, start: "09:00", end: "17:00", title: "Babysitter", assignment: { kind: "none" } });
  const editExisting = (s: ExistingShift) => setEditing(existingToProposal(s, crypto.randomUUID()));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => leave(() => changeMonth(shiftMonth(month, -1)))}><ChevronLeft /></Button>
        <div className="min-w-52 text-center"><h2 className="text-xl font-bold">{labelDate(`${month}-01`, { month: "long", year: "numeric" })}</h2><p className="text-xs text-muted-foreground">{data.timeZone} · Private draft{dirty ? " · Unsaved" : revision ? ` · Revision ${revision}` : ""}</p></div>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => leave(() => changeMonth(shiftMonth(month, 1)))}><ChevronRight /></Button></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => leave(() => modify({ shifts: [] }))}>Start Blank</Button>
        <Button variant="outline" disabled={busy} onClick={() => setTemplateOpen(true)}>Build from Template</Button>
        <Button disabled={busy || conflict || (!dirty && revision > 0)} onClick={() => void saveDraft()}><Save className="h-4 w-4" />Save Draft</Button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><div className="flex gap-4"><span className="text-member-sky-ink">● Existing</span><span className="text-member-sage-ink">● Proposed</span><span className="text-member-amber-ink">● Modified proposal</span></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setCoverageOpen(true)}><ShieldCheck className="h-4 w-4" />Check Coverage</Button><Button variant="outline" disabled={busy} onClick={() => void openReview()}><LockKeyhole className="h-4 w-4" />Review Schedule</Button></div></div>
    <dl className="grid grid-cols-4 divide-x divide-border border-y border-border py-3">
      {[["Proposed shifts", summary.proposals], ["Proposed hours", Number(summary.hours.toFixed(2))], ["Existing calendar shifts", summary.existing], ["Template conflicts", summary.conflicts]].map(([label, value]) => <div key={label} className="px-4 first:pl-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-2 flex items-center gap-2 text-sm"><Checkbox aria-label="Select all proposed shifts" checked={selection.length === draft.shifts.length && selection.length > 0 ? true : selection.length > 0 ? "indeterminate" : false} disabled={!draft.shifts.length} onCheckedChange={checked => setSelected(checked === true ? draft.shifts.map(s => s.id) : [])} />{selection.length ? `${selection.length} selected` : "Select proposals"}</label>
      {selection.length > 0 && <><Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>Change caregiver</Button><Button size="sm" variant="outline" onClick={() => { command({ kind: "remove", ids: selection }); setSelected([]); }}><Trash2 className="h-4 w-4" />Remove selected</Button><Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => setSelected([])}><X className="h-4 w-4" /></Button></>}
    </div>
    {message && <div role="status" className="flex items-center gap-3 text-sm"><p>{message}</p>{conflict && <Button variant="outline" disabled={busy} onClick={() => void reloadSaved()}>Reload saved draft</Button>}</div>}
    {!data.bundle.family?.babysitter_calendar_source_id && <p className="text-sm text-muted-foreground">No Babysitter calendar is selected. Drafts can still be saved.</p>}
    <div className="grid grid-cols-7 border-l border-t border-border">
      {weekdays.map(d => <div key={d} className="border-b border-r border-border bg-surface-muted px-2 py-2 text-xs font-semibold">{d}</div>)}
      {Array.from({ length: new Date(`${month}-01T12:00:00Z`).getUTCDay() }, (_, i) => <div key={`empty-${i}`} className="border-b border-r border-border bg-surface-muted/50" />)}
      {dates.map(date => <div key={date} onDragOver={event => drag.over(event, date)} onDrop={event => drag.drop(event, date)} className={cn("flex min-h-40 min-w-0 flex-col gap-1.5 border-b border-r border-border p-2", drag.dropDate === date && "bg-accent ring-2 ring-inset ring-ring")}>
        <div className="flex items-center justify-between"><Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`Add proposed shift on ${date}`} onClick={() => setEditing(newShift(date))}>{Number(date.slice(8))}</Button><Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`New shift on ${date}`} onClick={() => setEditing(newShift(date))}><Plus className="h-3 w-3" /></Button></div>
        {existing.filter(s => s.date <= date && s.endDate >= date).map(s => <article key={s.key} draggable={!s.allDay && s.date === s.endDate && s.start < s.end && !draft.shifts.some(p => sameIdentity(p, s))} onDragStart={event => { dragClickUntil.current = Infinity; drag.start(event, s.key); }} onDragEnd={() => { drag.end(); dragClickUntil.current = Date.now() + 250; }} className="rounded-md border border-member-sky bg-member-sky-soft p-2 text-member-sky-ink"><Button variant="ghost" draggable={false} disabled={s.allDay || s.date !== s.endDate || s.date !== date || s.start >= s.end || draft.shifts.some(p => p.existing?.occurrenceKey === s.key)}
          className="h-auto w-full min-w-0 justify-start whitespace-normal p-0 text-left text-xs font-bold underline disabled:opacity-100" title={s.title} aria-label={`Edit ${s.title} on ${date}`}
          onClick={() => { if (Date.now() >= dragClickUntil.current) editExisting(s); }}><span className="line-clamp-2 min-w-0 break-words [overflow-wrap:anywhere]">{s.title}</span></Button>
          <p className="mt-1 break-words text-xs tabular-nums">{s.allDay ? "All day" : s.date !== s.endDate ? `${s.date.slice(5)} ${s.start} – ${s.endDate.slice(5)} ${s.end}` : `${s.start}–${s.end}`}</p>
          <p className="mt-0.5 break-words text-[11px] italic">{assignmentLabel(s.assignment)}</p></article>)}
        {draft.shifts.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start)).map(s => <article key={s.id} draggable onDragStart={event => { dragClickUntil.current = Infinity; drag.start(event, s.id); }} onDragEnd={() => { drag.end(); dragClickUntil.current = Date.now() + 250; }} className={cn("rounded-md border p-1.5", proposalOrphaned(s, existing) ? "border-destructive bg-destructive/10 text-destructive" : s.existing || proposalNeedsReview(s, existing, draft.shifts) ? "border-member-amber bg-member-amber-soft text-member-amber-ink" : "border-member-sage bg-member-sage-soft text-member-sage-ink", selection.includes(s.id) && "ring-2 ring-ring")}>
          <div className="flex items-start gap-1"><Checkbox className="mt-0.5 shrink-0" aria-label={`Select proposal ${s.start} on ${date}`} checked={selection.includes(s.id)} onCheckedChange={checked => toggleSelected(s.id, checked === true)} />
            <Button variant="ghost" draggable={false} className="h-auto min-w-0 flex-1 items-start justify-start whitespace-normal px-1 py-0 text-left text-xs font-bold underline" title={s.title} aria-label={`Edit proposal ${s.title} on ${date}`} onClick={() => { if (Date.now() >= dragClickUntil.current) setEditing(s); }}><span className="line-clamp-2 min-w-0 break-words [overflow-wrap:anywhere]">{s.title}</span></Button>
          </div>
          <p className="mt-1 break-words text-xs tabular-nums">{s.start}–{s.end}</p>
          <p className="mt-0.5 break-words text-[11px] italic">{assignmentLabel(s.assignment)}</p>
          {proposalOrphaned(s, existing) ? <div className="mt-1 space-y-1"><p className="text-xs font-semibold">{orphanLabel[orphanStatus(s, existing, data.referenced, data.checkedEventIds, month) ?? "unresolved"]}</p><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { command({ kind: "remove", ids: [s.id] }); setSelected(sel => sel.filter(x => x !== s.id)); }}>Discard</Button>{orphanStatus(s, existing, data.referenced, data.checkedEventIds, month) === "deleted" && <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { const r = convertOrphanToNew(draftRef.current, s.id, existing, () => crypto.randomUUID()); modify(r.draft); setSelected(sel => sel.filter(x => x !== s.id)); setMessage(r.added ? "Converted to a new proposed shift. Save and refresh the review." : "Not added: it duplicates an existing shift or proposal."); }}>Convert to new</Button>}</div></div> : s.existing && <p className="mt-1 text-xs">Change proposed</p>}{proposalNeedsReview(s, existing, draft.shifts) && <p className="mt-1 text-xs">Review: duplicate or overlapping shift</p>}
          {s.existing && !proposalOrphaned(s, existing) && (shiftConfirmed(s, versionFor(s)) && !proposalNeedsReview(s, existing, draft.shifts)
            ? <p className="mt-1 flex items-center gap-1 text-xs"><Check className="h-3 w-3" />Accepted · unpublished</p>
            : <Button variant="ghost" size="sm" className="mt-1 h-auto max-w-full whitespace-normal px-1 py-1 text-xs" disabled={proposalNeedsReview(s, existing, draft.shifts) || !versionFor(s)} onClick={() => acceptChange(s.id)}>Accept Change</Button>)}
        </article>)}
        <div className="mt-auto space-y-0.5 pt-2 text-[10px] leading-snug text-muted-foreground">
          {(workDays[date] ?? []).map((p, i) => <div key={i} className="min-w-0 break-words">
            {p.intervals.length > 0 && <p>{p.label} · {p.intervals.map(([a, b]) => `${compactWorkTime(a)}–${compactWorkTime(b)}`).join(", ")}</p>}
            {((p.unavailable && p.intervals.length === 0) || p.manualReview) && <p>{p.label} · {p.manualReview ? "Work hours need review" : "Work hours unavailable"}</p>}
          </div>)}
        </div>
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
    {coverageOpen && <SmartCoverageDialog familyId={familyId} month={month} timeZone={data.timeZone} coverage={data.coverage} events={data.bundle.events} existing={existing}
      draft={draft} lineage={data.lineage} caregivers={caregivers} regularCaregiverId={data.regularCaregiverId} onClose={() => setCoverageOpen(false)}
      onAdd={(sg, a) => { const shift = suggestionToShift(sg, a, crypto.randomUUID()); const next = appendProposals(draftRef.current, [shift], existing);
        if (next.shifts.some(x => x.id === shift.id)) modify(next); else setMessage("That shift is already in the draft or on the calendar."); }}
      onDraft={(kind, value) => modify(kind === "ignore" ? ignoreSuggestion(draftRef.current, value) : setNoCare(draftRef.current, value, kind === "noCare"))}
      onSettingsSaved={async () => { await reload(); }} />}
    {reviewOpen && <ScheduleReviewDialog familyId={familyId} month={month} draft={draft} revision={revision} dirty={dirty} existing={existing} members={data.bundle.members} timeZone={data.timeZone} onClose={() => setReviewOpen(false)} />}
  </div>;
}

export function CaregiverSelect({ value, onChange, caregivers }: { value: Assignment; onChange: (a: Assignment) => void; caregivers: FamilyMember[] }) {
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