import type { TimesheetEntry, TimesheetView } from "./timesheets.functions";
import { hoursBetween, addDaysKey } from "./timesheet-periods";
import { workInputInstant } from "./caregiver-timezone";
import { timesheetRowStatus } from "./caregiver-timesheet";
import type { TimesheetDoc } from "./caregiver-timesheet-pdf";

/** Adapts the caller's authorized, counted entries; no household reads or independent identities. */
export function householdPdfRow(entry: TimesheetEntry, sheet: TimesheetView): TimesheetDoc["rows"][number] {
  return {
    workDate: entry.work_date, removed: false,
    scheduledStart: entry.scheduled_start ?? entry.actual_start, scheduledEnd: entry.scheduled_end ?? entry.actual_end,
    scheduledHours: hoursBetween(entry.scheduled_start, entry.scheduled_end),
    actualStart: entry.actual_start, actualEnd: entry.actual_end, actualHours: hoursBetween(entry.actual_start, entry.actual_end),
    confirmed: !sheet.upcoming && entry.actual_time_confirmed === true,
    note: entry.note,
  };
}

export const householdShiftStatus = (entry: TimesheetEntry, sheet: TimesheetView, now: number) => timesheetRowStatus(householdPdfRow(entry, sheet), now);

export function householdTimesheetDoc(sheet: TimesheetView, familyName: string, caregiverName: string): TimesheetDoc {
  return {
    familyName, caregiverName: sheet.caregiver_name || caregiverName, timezone: sheet.time_zone,
    from: new Date(workInputInstant(`${sheet.period_start}T00:00`, sheet.time_zone)),
    to: new Date(workInputInstant(`${addDaysKey(sheet.period_end, 1)}T00:00`, sheet.time_zone)),
    rows: sheet.entries.map(e => householdPdfRow(e, sheet)).sort((a, b) => a.workDate.localeCompare(b.workDate) || Date.parse(a.actualStart) - Date.parse(b.actualStart)),
  };
}