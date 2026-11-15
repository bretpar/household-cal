import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** Real instants with workspace-local getters; never shifted fake timestamps. */
export const workDate = (value: Date | string | number, timezone: string) => new TZDate(new Date(value).getTime(), timezone);
export const workInput = (value: string, timezone: string) => formatInTimeZone(value, timezone, "yyyy-MM-dd'T'HH:mm");
export const workOffset = (value: string, timezone: string) => formatInTimeZone(value, timezone, "xxx");
/** Every real occurrence of a wall time, sorted earlier first (empty for DST gaps). */
export function workInputInstants(value: string, timezone: string): string[] {
  const instant = fromZonedTime(value, timezone);
  if (!Number.isFinite(instant.getTime())) return [];
  const wallTime = Date.parse(`${value}Z`);
  if (!Number.isFinite(wallTime)) return [];
  const candidates = new Set<string>();
  // Sample both sides of nearby transitions, including non-hour offset changes.
  for (let hours = -48; hours <= 48; hours += 12) {
    const offset = formatInTimeZone(instant.getTime() + hours * 3600000, timezone, "xxx");
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
    if (!match) continue;
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1);
    const candidate = new Date(wallTime - minutes * 60000);
    if (workInput(candidate.toISOString(), timezone) === value) candidates.add(candidate.toISOString());
  }
  return [...candidates].sort();
}

export function workInputInstant(value: string, timezone: string, original?: string, selected?: string) {
  // Preserve the exact stored instant, including offset occurrence and seconds.
  if (!selected && original && workInput(original, timezone) === value) return original;
  const candidates = workInputInstants(value, timezone);
  if (!candidates.length) {
    throw new Error("Choose a valid time in your work time zone. This time may not exist during a daylight-saving change.");
  }
  if (selected && candidates.includes(selected)) return selected;
  if (candidates.length > 1) throw new Error("Choose the first or second occurrence of the repeated time.");
  const only = candidates[0];
  if (!only) throw new Error("Choose a valid time in your work time zone.");
  return only;
}
export const workDateInput = (value: Date) => format(value, "yyyy-MM-dd'T'HH:mm");