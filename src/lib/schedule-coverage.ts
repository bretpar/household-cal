import { sameIdentity, type ExistingShift } from "@/lib/schedule-builder";
import { computeCoverage, monthInRange, type CoverageInput, type CoverageResult, type CoverageSettings, type DayCoverage } from "@/lib/smart-coverage";

/** Adapt the displayed private schedule to the existing coverage engine. */
export function computeScheduleCoverage(input: CoverageInput, publishedEvents: Record<string, string> = {}, appliedRemovals: string[] = []): CoverageResult {
  const replaces = (shift: CoverageInput["draft"]["shifts"][number], existing: ExistingShift) =>
    sameIdentity(shift, existing) || publishedEvents[shift.id] === existing.eventId;
  const removals = (input.draft.removals ?? []).filter(s => !appliedRemovals.includes(s.id));
  const existing = input.existing.filter(e => !input.draft.shifts.some(s => replaces(s, e)) && !removals.some(s => replaces(s, e)));
  return computeCoverage({ ...input, existing });
}

/** Inline red warnings require complete work data for this particular day. */
export function confirmedCoverageGaps(result: CoverageResult, settings: CoverageSettings, month: string): Record<string, DayCoverage> {
  if (settings.parents.some(p => !p.sourceId || p.health !== "ok" || !monthInRange(month, p.range))) return {};
  return Object.fromEntries(result.days.filter(d => !d.ignoredAllDay && (d.status === "missing" || d.status === "partial") && d.uncovered.length > 0).map(d => [d.date, d]));
}