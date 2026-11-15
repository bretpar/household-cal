import { formatInTimeZone } from "date-fns-tz";
import type { WorkShift } from "./independent-caregiver";

export interface ShiftActual { shift_id: string; actual_start: string; actual_end: string; confirmed: boolean; note: string | null }
export interface TimesheetRow {
  shift: WorkShift; workDate: string; removed: boolean;
  scheduledStart: string; scheduledEnd: string; scheduledHours: number;
  actualStart: string; actualEnd: string; actualHours: number; confirmed: boolean; note: string | null;
}
const hours = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a)) / 3600000;

/**
 * One row per shift starting in [from, to). Unconfirmed rows mirror the live
 * scheduled times; confirmed rows keep their saved actual times. Removed shifts
 * appear only when confirmed hours exist (historical record).
 */
export function buildTimesheetRows(shifts: WorkShift[], actuals: ShiftActual[], from: Date, to: Date, timezone: string): TimesheetRow[] {
  const byShift = new Map(actuals.map(a => [a.shift_id, a]));
  return shifts
    .filter(s => Date.parse(s.start_at) >= from.getTime() && Date.parse(s.start_at) < to.getTime())
    .filter(s => !s.deleted_at || byShift.get(s.id)?.confirmed)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map(shift => {
      const saved = byShift.get(shift.id);
      const confirmed = Boolean(saved?.confirmed);
      const actualStart = confirmed && saved ? saved.actual_start : shift.start_at;
      const actualEnd = confirmed && saved ? saved.actual_end : shift.end_at;
      return { shift, workDate: formatInTimeZone(shift.start_at, timezone, "yyyy-MM-dd"), removed: Boolean(shift.deleted_at),
        scheduledStart: shift.start_at, scheduledEnd: shift.end_at, scheduledHours: shift.deleted_at ? 0 : hours(shift.start_at, shift.end_at),
        actualStart, actualEnd, actualHours: confirmed ? hours(actualStart, actualEnd) : 0, confirmed, note: saved?.note ?? null };
    });
}
export function timesheetTotals(rows: TimesheetRow[]) {
  return { scheduled: rows.reduce((s, r) => s + r.scheduledHours, 0), confirmed: rows.reduce((s, r) => s + r.actualHours, 0),
    unconfirmed: rows.filter(r => !r.confirmed).length };
}
export const formatHoursValue = (h: number) => Number(h.toFixed(2)).toString();
