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
  proposalConflictReason,
  sameSlot,
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
    // A previously applied proposal is identified by the event it was applied
    // to. For a moved recurring occurrence that is the detached replacement,
    // while shift.existing still names the (now excluded) parent occurrence.
    const mappedEventId = mappedEvents[shift.id];
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
    if (sameSlot(shift, match)) {
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

  // Use the same effective-interval rules as manual/template/coverage proposals.
  // Orphans remain conflicts; unchanged recurring occurrences are preserved.
  for (const op of ops) {
    if (op.kind !== "create" && op.kind !== "update") continue;
    const shift = draft.shifts.find(s => s.id === op.shiftId);
    if (!shift) continue;
    const reason = proposalConflictReason(shift, existing, draft.shifts, mappedEvents);
    if (reason) {
      op.kind = "conflict";
      op.requiresReview = true;
      op.reason = reason;
      op.occurrenceDate ??= shift.date;
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
