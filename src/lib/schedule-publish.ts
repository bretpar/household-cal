/**
 * Pure publish planning for the private Babysitter Schedule Builder.
 *
 * Compares a saved draft with the current calendar state and classifies every
 * draft shift and every existing month occurrence. Identity comes only from
 * stored event/occurrence/split-lineage references — never from title or time
 * matching. Existing occurrences are preserved by default: absence from a
 * draft never implies deletion, and modifying or removing one always requires
 * explicit reviewed intent from the Owner.
 *
 * UI-free by design so the same rules can back a future mobile review flow.
 */
import {
  existingMonthShifts,
  proposalNeedsReview,
  sameIdentity,
  type ExistingShift,
  type Lineage,
  type ProposedShift,
  type ScheduleDraft,
} from "@/lib/schedule-builder";
import type { CalendarEvent } from "@/lib/family-data";

export type PublishOpKind = "unchanged" | "create" | "update" | "exclude" | "conflict";

export interface PublishPlanOp {
  shiftId: string;
  kind: PublishOpKind;
  /** Set when the shift references an existing occurrence. */
  eventId: string | null;
  occurrenceKey: string | null;
  /** Original occurrence date (household wall time) for scoped updates/exclusions. */
  occurrenceDate: string | null;
  /** True when the op changes or removes an existing occurrence and must be explicitly reviewed. */
  requiresReview: boolean;
  reason: string | null;
  /**
   * Authoritative original occurrence for reviewed modifications, taken from
   * the server's calendar state. `eventVersion` is bound server-side to the
   * same version used for concurrency protection; null means unverified.
   */
  original?: OriginalShift | null;
}

export interface OriginalShift {
  eventId: string;
  occurrenceKey: string;
  date: string;
  endDate: string;
  start: string;
  end: string;
  allDay: boolean;
  title: string;
  assignment: ExistingShift["assignment"];
  recurring: boolean;
  eventVersion: string | null;
}

function originalOf(e: ExistingShift): OriginalShift {
  return { eventId: e.eventId, occurrenceKey: e.key, date: e.date, endDate: e.endDate, start: e.start, end: e.end,
    allDay: e.allDay, title: e.title, assignment: e.assignment, recurring: !!e.recurring, eventVersion: null };
}

export interface PublishPlan {
  ops: PublishPlanOp[];
  /** Existing month occurrences no draft shift references; preserved as-is, never deleted. */
  preserved: ExistingShift[];
  counts: Record<PublishOpKind, number> & { preserved: number };
}

function sameSlotAsDraft(shift: ProposedShift, e: ExistingShift): boolean {
  const a = shift.assignment;
  const b = e.assignment;
  const sameAssignment =
    a.kind === b.kind &&
    (a.kind === "caregiver"
      ? b.kind === "caregiver" && a.family_member_id === b.family_member_id
      : a.kind === "other"
        ? b.kind === "other" && a.name.trim() === b.name.trim()
        : true);
  return (
    shift.date === e.date &&
    shift.start === e.start &&
    shift.end === e.end &&
    sameAssignment &&
    !e.allDay &&
    e.endDate === e.date
  );
}

/**
 * Classifies one saved draft against the current calendar. `existing` must be
 * the authoritative current month occurrences (expanded recurring masters and
 * detached exceptions included), projected into household wall time.
 */
export function planPublish(draft: ScheduleDraft, existing: ExistingShift[], mappedEvents: Record<string, string> = {}): PublishPlan {
  const ops: PublishPlanOp[] = [];
  const referenced = new Set<string>();

  for (const shift of draft.shifts) {
    const ref = shift.existing;
    const mappedEventId = !ref ? mappedEvents[shift.id] : undefined;
    if (mappedEventId) {
      const match = existing.find((e) => e.eventId === mappedEventId);
      if (match) referenced.add(match.key);
      ops.push({
        shiftId: shift.id,
        kind: match ? "update" : "conflict",
        eventId: mappedEventId,
        occurrenceKey: match?.key ?? null,
        occurrenceDate: match?.date ?? null,
        requiresReview: true,
        reason: match ? "This proposal updates its previously published event." : "The previously published event is no longer available in this month.",
        original: match ? originalOf(match) : null,
      });
      continue;
    }
    if (!ref) {
      // Unresolved template mismatch against current calendar occurrences, or a
      // duplicate of an earlier draft shift: never an ordinary publishable create.
      const duplicate = draft.shifts.slice(0, draft.shifts.indexOf(shift)).some((o) =>
        o.date === shift.date && o.start === shift.start && o.end === shift.end &&
        JSON.stringify(o.assignment) === JSON.stringify(shift.assignment));
      if (duplicate || proposalNeedsReview(shift, existing)) {
        ops.push({
          shiftId: shift.id,
          kind: "conflict",
          eventId: null,
          occurrenceKey: null,
          occurrenceDate: shift.date,
          requiresReview: true,
          reason: duplicate
            ? "This proposal duplicates another proposed shift."
            : "This proposal conflicts with an existing calendar shift on this day. Resolve it in the builder.",
        });
        continue;
      }
      ops.push({
        shiftId: shift.id,
        kind: "create",
        eventId: null,
        occurrenceKey: null,
        occurrenceDate: null,
        requiresReview: false,
        reason: null,
      });
      continue;
    }
    const match = existing.find((e) => sameIdentity(shift, e));
    if (!match) {
      // The referenced occurrence is gone or changed remotely since the draft
      // was saved. Never guess a replacement by title or time.
      ops.push({
        shiftId: shift.id,
        kind: "conflict",
        eventId: ref.eventId,
        occurrenceKey: ref.occurrenceKey,
        occurrenceDate: ref.splitFromDate ?? shift.date,
        requiresReview: true,
        reason: "The calendar occurrence this proposal references is no longer available.",
      });
      continue;
    }
    referenced.add(match.key);
    if (sameSlotAsDraft(shift, match)) {
      ops.push({
        shiftId: shift.id,
        kind: "unchanged",
        eventId: match.eventId,
        occurrenceKey: match.key,
        occurrenceDate: match.date,
        requiresReview: false,
        reason: null,
      });
    } else {
      ops.push({
        shiftId: shift.id,
        kind: "update",
        eventId: match.eventId,
        occurrenceKey: match.key,
        occurrenceDate: match.date,
        requiresReview: true,
        reason: "This proposal changes an existing calendar occurrence.",
        original: originalOf(match),
      });
    }
  }

  const preserved = existing.filter((e) => !referenced.has(e.key));
  const counts = {
    unchanged: 0,
    create: 0,
    update: 0,
    exclude: 0,
    conflict: 0,
    preserved: preserved.length,
  };
  for (const op of ops) counts[op.kind] += 1;
  return { ops, preserved, counts };
}

/** Current month occurrences for planning, straight from the shared engine. */
export function currentMonthOccurrences(
  events: CalendarEvent[],
  month: string,
  timeZone: string,
  lineage: Lineage,
): ExistingShift[] {
  return existingMonthShifts(events, month, timeZone, lineage);
}
