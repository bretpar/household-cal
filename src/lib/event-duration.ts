/** Preserve elapsed duration; callers resolve wall inputs in their existing zone. */
export function endAfterStartChange(start: string, end: string, nextStart: string): string | null {
  const duration = Date.parse(end) - Date.parse(start);
  const next = Date.parse(nextStart);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(next)) return null;
  return new Date(next + duration).toISOString();
}

/** Same-day editors keep a preserved end when it stays on the day, else clamp to 23:59 so a start edit is never refused. */
export function clampSameDayEnd(day: string, endWall: string | null): string {
  if (endWall && endWall.slice(0, 10) === day) return endWall.slice(11);
  return "23:59";
}