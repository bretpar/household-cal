import { formatInTimeZone } from "date-fns-tz";
import type { WorkShift } from "./independent-caregiver";

export interface ShiftActual { shift_id: string; actual_start: string; actual_end: string; confirmed: boolean; note: string | null; work_date?: string | null; client_id?: string | null }
export interface TimesheetRow {
  shift: WorkShift; workDate: string; removed: boolean;
  scheduledStart: string; scheduledEnd: string; scheduledHours: number;
  actualStart: string; actualEnd: string; actualHours: number; confirmed: boolean; note: string | null;
}
const hours = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a)) / 3600000;

/**
 * Legacy confirmed records are explicit adjustments; other rows follow schedule.
 * Saved work dates retain adjustments even after a shift moves out of the period.
 */
export function buildTimesheetRows(shifts: WorkShift[], actuals: ShiftActual[], from: Date, to: Date, timezone: string): TimesheetRow[] {
  const byShift = new Map(actuals.map(a => [a.shift_id, a]));
  return shifts
    .filter(s => {
      const saved = byShift.get(s.id);
      const key = saved?.confirmed && saved.work_date ? saved.work_date : formatInTimeZone(s.start_at, timezone, "yyyy-MM-dd");
      return key >= formatInTimeZone(from, timezone, "yyyy-MM-dd") && key < formatInTimeZone(to, timezone, "yyyy-MM-dd");
    })
    .filter(s => !s.deleted_at || byShift.get(s.id)?.confirmed)
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map(shift => {
      const saved = byShift.get(shift.id);
      const confirmed = Boolean(saved?.confirmed);
      const actualStart = confirmed && saved ? saved.actual_start : shift.start_at;
      const actualEnd = confirmed && saved ? saved.actual_end : shift.end_at;
      return { shift, workDate: confirmed && saved?.work_date ? saved.work_date : formatInTimeZone(shift.start_at, timezone, "yyyy-MM-dd"), removed: Boolean(shift.deleted_at),
        scheduledStart: shift.start_at, scheduledEnd: shift.end_at, scheduledHours: shift.deleted_at ? 0 : hours(shift.start_at, shift.end_at),
        actualStart, actualEnd, actualHours: hours(actualStart, actualEnd), confirmed, note: confirmed ? saved?.note ?? null : null };
    });
}
export function timesheetTotals(rows: TimesheetRow[]) {
  return { scheduled: rows.reduce((s, r) => s + r.scheduledHours, 0), effective: rows.reduce((s, r) => s + r.actualHours, 0),
    adjusted: rows.filter(r => r.confirmed).length };
}
export const formatHoursValue = (h: number) => Number(h.toFixed(2)).toString();
