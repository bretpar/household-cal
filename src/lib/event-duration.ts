/** Preserve elapsed duration; callers resolve wall inputs in their existing zone. */
export function endAfterStartChange(start: string, end: string, nextStart: string): string | null {
  const duration = Date.parse(end) - Date.parse(start);
  const next = Date.parse(nextStart);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(next)) return null;
  return new Date(next + duration).toISOString();
}