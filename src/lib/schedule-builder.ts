import { z } from "zod";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { expandOccurrences, type CalendarEvent } from "@/lib/family-data";
import { addDaysKey } from "@/lib/timesheet-periods";

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.iso.date();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const assignmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("caregiver"), family_member_id: z.uuid() }),
  z.object({ kind: z.literal("other"), name: z.string().trim().min(1).max(100) }),
  z.object({ kind: z.literal("none") }),
]);
export type Assignment = z.infer<typeof assignmentSchema>;
export const shiftSchema = z.object({
  id: z.uuid(), date: dateSchema, start: timeSchema, end: timeSchema,
  title: z.string().trim().min(1).max(200), assignment: assignmentSchema,
  confirmation: z.object({ signature: z.string().max(2000), eventVersion: z.string() }).optional(),
  existing: z.object({ eventId: z.uuid(), occurrenceKey: z.string().max(200),
    startAt: z.iso.datetime({ offset: true }), splitFromEventId: z.uuid().nullable(), splitFromDate: dateSchema.nullable(),
  }).optional(),
}).refine(s => s.start < s.end, { message: "End time must be after start time (same day)." });
export type ProposedShift = z.infer<typeof shiftSchema>;
/** Confirmation is valid only for this exact proposal and reviewed original version. */
export function shiftConfirmationSignature(s: ProposedShift): string {
  return JSON.stringify([s.id, s.date, s.start, s.end, s.title, s.assignment, s.existing ?? null]);
}
export function shiftConfirmed(s: ProposedShift, eventVersion: string | null | undefined): boolean {
  return !!eventVersion && s.confirmation?.eventVersion === eventVersion
    && s.confirmation.signature === shiftConfirmationSignature(s);
}
export function existingToProposal(s: ExistingShift, id: string): ProposedShift {
  if (s.allDay || s.date !== s.endDate || s.start >= s.end) throw new Error("Only same-day timed shifts can be changed here.");
  return { id, date: s.date, start: s.start, end: s.end, title: s.title, assignment: s.assignment,
    existing: { eventId: s.eventId, occurrenceKey: s.key, startAt: s.startAt,
      splitFromEventId: s.splitFromEventId, splitFromDate: s.splitFromDate } };
}
export function acceptShiftChange(draft: ScheduleDraft, id: string, existing: ExistingShift[], eventVersion: string | null | undefined): ScheduleDraft {
  const s = draft.shifts.find(s => s.id === id);
  if (!s?.existing || !eventVersion || proposalOrphaned(s, existing) || proposalNeedsReview(s, existing, draft.shifts)) {
    throw new Error("Resolve the shift conflict and refresh the calendar before accepting this change.");
  }
  return draftSchema.parse({ ...draft, shifts: draft.shifts.map(p => p.id === id
    ? { ...p, confirmation: { signature: shiftConfirmationSignature(p), eventVersion } } : p) });
}
/** Smart Coverage decisions, private to the monthly draft; never published. */
export const coverageDecisionsSchema = z.object({ ignored: z.array(z.string().max(40)).max(500), noCare: z.array(dateSchema).max(31) });
export const draftSchema = z.object({ shifts: z.array(shiftSchema).max(500), removals: z.array(shiftSchema).max(500).optional(), coverage: coverageDecisionsSchema.optional() }).superRefine((d, ctx) => {
  const ids = new Set<string>(); const refs = new Set<string>();
  for (const s of d.shifts) {
    if (ids.has(s.id) || (s.existing && refs.has(s.existing.occurrenceKey))) ctx.addIssue({ code: "custom", message: "Duplicate draft shift identity." });
    ids.add(s.id); if (s.existing) refs.add(s.existing.occurrenceKey);
  }
  for (const s of d.removals ?? []) {
    if (ids.has(s.id) || (s.existing && refs.has(s.existing.occurrenceKey))) ctx.addIssue({ code: "custom", message: "Duplicate draft removal identity." });
    ids.add(s.id); if (s.existing) refs.add(s.existing.occurrenceKey);
  }
});
export type ScheduleDraft = z.infer<typeof draftSchema>;
/** Deletion intent only; published identity stays intact and undo restores any proposal. */
export function deleteDraftShift(draft: ScheduleDraft, shift: ProposedShift, published = !!shift.existing): ScheduleDraft {
  return draftSchema.parse({ ...draft, shifts: draft.shifts.filter(s => s.id !== shift.id),
    removals: published ? [...(draft.removals ?? []).filter(s => s.id !== shift.id), shift] : draft.removals });
}
export function undoDraftRemoval(draft: ScheduleDraft, id: string): ScheduleDraft {
  const shift = draft.removals?.find(s => s.id === id);
  if (!shift) return draft;
  return draftSchema.parse({ ...draft, shifts: [...draft.shifts, shift], removals: draft.removals?.filter(s => s.id !== id) });
}
export const templateSchema = z.object({
  assignment: assignmentSchema,
  weekdays: z.array(z.object({ day: z.number().int().min(0).max(6), start: timeSchema, end: timeSchema })
    .refine(d => d.start < d.end, { message: "End time must be after start time." })).min(1).max(7),
}).refine(t => new Set(t.weekdays.map(d => d.day)).size === t.weekdays.length, { message: "Choose each weekday once." });
export type ScheduleTemplate = z.infer<typeof templateSchema>;

export function monthDates(month: string): string[] {
  monthSchema.parse(month);
  const out: string[] = [];
  for (let key = `${month}-01`; key.startsWith(month); key = addDaysKey(key, 1)) out.push(key);
  return out;
}
export function shiftMonth(month: string, offset: number): string {
  const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
export function buildTemplate(month: string, template: ScheduleTemplate, makeId: () => string): ProposedShift[] {
  const t = templateSchema.parse(template);
  return monthDates(month).flatMap(date => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const row = t.weekdays.find(w => w.day === day);
    return row ? [{ id: makeId(), date, start: row.start, end: row.end, title: "Babysitter", assignment: t.assignment }] : [];
  });
}
export interface ExistingShift {
  key: string; eventId: string; date: string; title: string; start: string; end: string;
  allDay: boolean; assignment: Assignment; startAt: string; endDate: string;
  splitFromEventId: string | null; splitFromDate: string | null;
  recurring?: boolean;
}
export type Lineage = Record<string, { split_from_event_id: string | null; split_from_date: string | null }>;

/** Project into household wall time before using the unchanged calendar recurrence engine. */
export function existingMonthShifts(events: CalendarEvent[], month: string, timeZone: string, lineage: Lineage): ExistingShift[] {
  const dates = monthDates(month); const last = dates.at(-1) ?? `${month}-01`;
  const originals = new Map(events.map(e => [e.id, e]));
  const wallEvents = events.map(e => e.all_day ? e : ({ ...e,
    start_at: toZonedTime(e.start_at, timeZone).toISOString(),
    end_at: toZonedTime(e.end_at, timeZone).toISOString(),
  }));
  const from = new Date(`${addDaysKey(`${month}-01`, -1)}T00:00:00`);
  const to = new Date(`${last}T23:59:59`);
  return expandOccurrences(wallEvents, from, to).flatMap(o => {
    const e = originals.get(o.event.id); if (!e) return [];
    const start = e.all_day ? o.start : e.recurrence_rule
      ? fromZonedTime(o.start, timeZone) : new Date(e.start_at);
    const end = e.all_day ? o.end : new Date(start.getTime() + Date.parse(e.end_at) - Date.parse(e.start_at));
    const date = e.all_day ? `${o.start.getFullYear()}-${String(o.start.getMonth()+1).padStart(2,"0")}-${String(o.start.getDate()).padStart(2,"0")}` : formatInTimeZone(start, timeZone, "yyyy-MM-dd");
    const endDate = e.all_day ? date : formatInTimeZone(new Date(end.getTime()-1), timeZone, "yyyy-MM-dd");
    if (date > last || endDate < `${month}-01`) return [];
    const link = lineage[e.id];
    return [{ key: `${e.id}-${start.toISOString()}`, eventId: e.id, date,
      title: e.title, start: e.all_day ? "00:00" : formatInTimeZone(start, timeZone, "HH:mm"),
      end: e.all_day ? "23:59" : formatInTimeZone(end, timeZone, "HH:mm"), allDay: e.all_day,
      assignment: e.shift_assignment ?? { kind: "none" as const }, startAt: start.toISOString(), endDate,
      splitFromEventId: link?.split_from_event_id ?? null, splitFromDate: link?.split_from_date ?? null,
      recurring: !!e.recurrence_rule || !!link?.split_from_event_id,
    }];
  });
}

function sameAssignment(a: Assignment, b: Assignment): boolean {
  return a.kind === b.kind && (a.kind === "caregiver" ? b.kind === "caregiver" && a.family_member_id === b.family_member_id
    : a.kind === "other" ? b.kind === "other" && a.name.trim() === b.name.trim() : true);
}
export function sameSlot(a: ProposedShift, b: ProposedShift | ExistingShift): boolean {
  return a.date === b.date && a.start === b.start && a.end === b.end && sameAssignment(a.assignment, b.assignment)
    && (!("allDay" in b) || (!b.allDay && b.endDate === b.date));
}
export function sameIdentity(a: ProposedShift, b: ProposedShift | ExistingShift): boolean {
  const ref = a.existing;
  if (!ref) return false;
  const other = "key" in b ? { eventId: b.eventId, occurrenceKey: b.key, startAt: b.startAt,
    splitFromEventId: b.splitFromEventId, splitFromDate: b.splitFromDate } : b.existing;
  if (!other) return false;
  if (ref.occurrenceKey === other.occurrenceKey || (ref.eventId === other.eventId && Date.parse(ref.startAt) === Date.parse(other.startAt))) return true;
  const origin = ref.splitFromEventId ?? ref.eventId;
  const otherOrigin = other.splitFromEventId ?? other.eventId;
  return origin === otherOrigin && (ref.splitFromDate ?? a.date) === (other.splitFromDate ?? b.date);
}

/** Household wall-time intervals are half-open: adjacent shifts never overlap.
 * Existing endDate is the last occupied date (midnight ends belong to the previous day).
 * Date/time tuples avoid device-timezone conversion and retain overnight/all-day boundaries. */
function shiftInterval(s: ProposedShift | ExistingShift): [string, string] {
  const existing = "key" in s;
  const start = `${s.date}T${existing && s.allDay ? "00:00" : s.start}`;
  const lastDate = existing ? s.endDate : s.date;
  const end = existing && (s.allDay || s.end === "00:00")
    ? `${addDaysKey(lastDate, 1)}T00:00` : `${lastDate}T${s.end}`;
  return [start, end];
}

export function shiftsOverlap(a: ProposedShift, b: ProposedShift | ExistingShift): boolean {
  const [aStart, aEnd] = shiftInterval(a);
  const [bStart, bEnd] = shiftInterval(b);
  return aStart < bEnd && bStart < aEnd;
}

/** Shared by the desktop builder and authoritative review. Resolve references by
 * stable identity, then compare the effective proposed intervals, not date alone.
 * Overlaps remain review blockers regardless of caregiver; assignment differences
 * never make simultaneous, incompatible coverage silently publishable. */
export function proposalConflictReason(shift: ProposedShift, existing: ExistingShift[], proposals: ProposedShift[] = [],
  mappedEvents: Record<string, string> = {}): string | null {
  const targets = (p: ProposedShift, e: ExistingShift) => sameIdentity(p, e)
    || mappedEvents[p.id] === e.eventId;
  const others = proposals.filter(p => p !== shift);
  if (others.some(p => p.id === shift.id || sameIdentity(shift, p) || sameSlot(shift, p))) {
    return "This proposal duplicates another proposed shift.";
  }
  const kept = existing.filter(e => !targets(shift, e) && !others.some(p => targets(p, e)));
  if (kept.some(e => sameSlot(shift, e))) return "This proposal duplicates an existing calendar shift.";
  if (kept.some(e => shiftsOverlap(shift, e))) return "This proposal overlaps an existing calendar shift. Resolve it in the builder.";
  if (others.some(p => shiftsOverlap(shift, p))) return "This proposal overlaps another proposed shift. Resolve it in the builder.";
  return null;
}

/** Keep conflicts visible for review; never remove or overwrite a calendar occurrence. */
export function proposalNeedsReview(shift: ProposedShift, existing: ExistingShift[], proposals: ProposedShift[] = []): boolean {
  return proposalConflictReason(shift, existing, proposals) !== null;
}

/** A change proposal whose referenced calendar occurrence is no longer present in the month. */
export function proposalOrphaned(shift: ProposedShift, existing: ExistingShift[]): boolean {
  return !!shift.existing && !existing.some(e => sameIdentity(shift, e));
}

export interface ReferencedEvent { onSitterCalendar: boolean; month: string; recurring: boolean }
/**
 * Why a referenced occurrence is missing from this month. "deleted" only when the
 * server looked the event up and it no longer exists; "moved" when it now starts
 * in another month on the Babysitter calendar; otherwise "unresolved". All stay conflicts.
 */
export type OrphanStatus = "deleted" | "moved" | "unresolved";
export function orphanStatus(shift: ProposedShift, existing: ExistingShift[], referenced: Record<string, ReferencedEvent>,
  checkedEventIds: readonly string[], month: string): OrphanStatus | null {
  if (!proposalOrphaned(shift, existing)) return null;
  const id = shift.existing!.eventId; const row = referenced[id];
  if (!row) return checkedEventIds.includes(id) ? "deleted" : "unresolved";
  if (row.onSitterCalendar && !row.recurring && row.month !== month) return "moved";
  return "unresolved";
}
export const orphanLabel: Record<OrphanStatus, string> = {
  deleted: "Original calendar shift no longer exists",
  moved: "Original calendar shift moved to another month",
  unresolved: "Original calendar shift isn't in this month — check the calendar",
};

/** Owner-confirmed: drop the dead reference and re-add as a standalone proposal through normal reconciliation.
 * Never recreates or restores the deleted occurrence; a duplicate of an existing slot or proposal is dropped. */
export function convertOrphanToNew(draft: ScheduleDraft, id: string, existing: ExistingShift[], makeId: () => string): { draft: ScheduleDraft; added: boolean } {
  const shift = draft.shifts.find(s => s.id === id);
  if (!shift || !proposalOrphaned(shift, existing)) return { draft, added: false };
  const { existing: _ref, ...rest } = shift;
  const fresh: ProposedShift = { ...rest, id: makeId() };
  const next = appendProposals({ ...draft, shifts: draft.shifts.filter(s => s.id !== id) }, [fresh], existing);
  return { draft: next, added: next.shifts.some(s => s.id === fresh.id) };
}

/** Reconcile identities first, then intended household date/time/caregiver slots. */
export function appendProposals(draft: ScheduleDraft, shifts: ProposedShift[], existing: ExistingShift[] = []): ScheduleDraft {
  const result = [...draft.shifts];
  for (const shift of shifts) {
    const kept = existing.filter(e => !result.some(p => sameIdentity(p, e)));
    if (kept.some(e => sameIdentity(shift, e) || (!shift.existing && sameSlot(shift, e)))
      || result.some(p => p.id === shift.id || sameIdentity(shift, p) || (!shift.existing && sameSlot(shift, p)))) continue;
    result.push(shift);
  }
  return draftSchema.parse({ ...draft, shifts: result });
}

/** All editor commands affect proposals only, retaining original occurrence references. */
export type ScheduleCommand =
  | { kind: "keep"; shift: ProposedShift }
  | { kind: "move"; id: string; date: string }
  | { kind: "assign"; ids: string[]; assignment: Assignment }
  | { kind: "remove"; ids: string[] };

export function editSchedule(draft: ScheduleDraft, month: string, command: ScheduleCommand): ScheduleDraft {
  monthSchema.parse(month);
  let shifts = draft.shifts;
  switch (command.kind) {
    case "keep": shifts = [...shifts.filter(s => s.id !== command.shift.id), command.shift]; break;
    case "move": shifts = shifts.map(s => s.id === command.id ? { ...s, date: command.date } : s); break;
    case "assign": {
      const assignment = assignmentSchema.parse(command.assignment);
      shifts = shifts.map(s => command.ids.includes(s.id) ? { ...s, assignment } : s); break;
    }
    case "remove": shifts = shifts.filter(s => !command.ids.includes(s.id)); break;
  }
  const next = draftSchema.parse({ ...draft, shifts });
  if (next.shifts.some(s => !s.date.startsWith(`${month}-`))) throw new Error("Proposals must stay in the selected month.");
  return next;
}

export function scheduleSummary(draft: ScheduleDraft, existing: ExistingShift[]) {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return {
    proposals: draft.shifts.length,
    hours: draft.shifts.reduce((sum, s) => sum + minutes(s.end) - minutes(s.start), 0) / 60,
    existing: new Set(existing.map(s => s.key)).size,
    conflicts: draft.shifts.filter(s => proposalNeedsReview(s, existing, draft.shifts) || proposalOrphaned(s, existing)).length,
  };
}