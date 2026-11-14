import { sameIdentity, type ExistingShift } from "@/lib/schedule-builder";
import { computeCoverage, type CoverageInput, type CoverageResult, type CoverageSettings, type DayCoverage, type ParentWorkDay } from "@/lib/smart-coverage";

/** Adapt the displayed private schedule to the existing coverage engine. */
export function computeScheduleCoverage(input: CoverageInput, publishedEvents: Record<string, string> = {}, appliedRemovals: string[] = []): CoverageResult {
  const replaces = (shift: CoverageInput["draft"]["shifts"][number], existing: ExistingShift) =>
    sameIdentity(shift, existing) || publishedEvents[shift.id] === existing.eventId;
  const removals = (input.draft.removals ?? []).filter(s => !appliedRemovals.includes(s.id));
  const existing = input.existing.filter(e => !input.draft.shifts.some(s => replaces(s, e)) && !removals.some(s => replaces(s, e)));
  return computeCoverage({ ...input, existing });
}

/** Inline red warnings require complete work data for this particular day. */
export function confirmedCoverageGaps(result: CoverageResult, settings: CoverageSettings, _month?: string): Record<string, DayCoverage> {
  if (settings.parents.some(p => !p.sourceId || p.health !== "ok")) return {};
  return Object.fromEntries(result.days.filter(d => !d.ignoredAllDay && (d.status === "missing" || d.status === "partial") && d.uncovered.length > 0).map(d => [d.date, d]));
}

/** Compact household-time label: 480 -> "8a", 450 -> "7:30a", 930 -> "3:30p". */
export const compactWorkTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60) % 24, minute = minutes % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "a" : "p"}`;
};

/**
 * Monthly-grid work-hours lines: only work hours the parent's calendar actually
 * shows. Missing, hidden or out-of-range work data renders nothing here — its
 * incomplete-data warnings stay inside Check Coverage.
 */
export function workHourLines(day: ParentWorkDay): string[] {
  if (day.intervals.length === 0) return [];
  return [`${day.label} · ${day.intervals.map(([a, b]) => `${compactWorkTime(a)}–${compactWorkTime(b)}`).join(", ")}`];
}