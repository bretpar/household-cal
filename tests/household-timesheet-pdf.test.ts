import { describe, expect, it } from "vitest";
import type { TimesheetEntry, TimesheetView } from "../src/lib/timesheets.functions";
import { householdShiftStatus, householdTimesheetDoc } from "../src/lib/household-timesheet-pdf";
import { timesheetTotals } from "../src/lib/caregiver-timesheet";

const entry: TimesheetEntry = {
  id: "entry", event_id: "event", work_date: "2026-11-10", scheduled_title: null,
  scheduled_start: "2026-11-10T17:00:00Z", scheduled_end: "2026-11-10T21:00:00Z",
  actual_start: "2026-11-10T17:00:00Z", actual_end: "2026-11-10T21:00:00Z",
  actual_start_local: "09:00", actual_end_local: "13:00", is_manual: false, note: "Saved note",
};
const sheet: TimesheetView = {
  id: "sheet", caregiver_name: "Alex", period_start: "2026-11-01", period_end: "2026-11-15",
  status: "draft", parent_note: null, submitted_at: null, time_zone: "America/Los_Angeles", entries: [entry],
};

describe("household babysitter PDF presentation", () => {
  it("does not label future scheduled hours as confirmed", () => {
    expect(householdShiftStatus(entry, sheet, Date.parse("2026-11-10T16:59:00Z"))).toBe("future");
    expect(householdShiftStatus(entry, sheet, Date.parse("2026-11-10T17:00:00Z"))).toBe("unconfirmed");
  });
  it("distinguishes unchanged confirmation from adjusted actuals", () => {
    expect(householdShiftStatus({ ...entry, actual_time_confirmed: true }, sheet, Date.now())).toBe("confirmed");
    expect(householdShiftStatus({ ...entry, actual_time_confirmed: true, actual_end: "2026-11-10T22:00:00Z" }, sheet, Date.now())).toBe("adjusted");
  });
  it("does not treat closing a timesheet as confirming its shifts", () => {
    const closed = { ...sheet, status: "closed" as const };
    const afterShift = Date.parse("2026-11-11T00:00:00Z");
    expect(householdShiftStatus(entry, closed, afterShift)).toBe("unconfirmed");
    expect(householdTimesheetDoc(closed, "Parker Family", "").rows[0]?.confirmed).toBe(false);
    expect(householdShiftStatus({ ...entry, actual_time_confirmed: true }, closed, afterShift)).toBe("confirmed");
  });
  it("keeps retained dates and actual hours in household exports", () => {
    const moved = { ...entry, actual_time_confirmed: true, actual_end: "2026-11-10T22:30:00Z", scheduled_start: "2026-12-10T17:00:00Z", scheduled_end: "2026-12-10T21:00:00Z" };
    const doc = householdTimesheetDoc({ ...sheet, entries: [moved] }, "Parker Family", "");
    expect(doc.rows[0]?.workDate).toBe("2026-11-10");
    expect(timesheetTotals(doc.rows)).toEqual({ scheduled: 4, effective: 5.5, adjusted: 1 });
    expect(doc.caregiverName).toBe("Alex");
  });
  it("uses the configured household period including its last date", () => {
    const doc = householdTimesheetDoc(sheet, "Parker Family", "");
    expect(doc.from.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(doc.to.toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
});