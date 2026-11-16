import { describe, expect, it } from "vitest";
import { buildTimesheetRows, timesheetTotals } from "../src/lib/caregiver-timesheet";
const shift = (id: string, start: string, end: string, deleted_at: string | null = null) => ({ id, user_id: "u", client_id: "c", start_at: start, end_at: end, notes: null, version: "v", deleted_at });
const from = new Date("2026-11-09T08:00:00Z"), to = new Date("2026-11-16T08:00:00Z");
describe("caregiver timesheet rows", () => {
  it("unedited rows follow scheduled shifts and contribute scheduled effective hours", () => {
    const rows = buildTimesheetRows([shift("a", "2026-11-10T17:00:00Z", "2026-11-10T21:00:00Z")], [], from, to, "America/Los_Angeles");
    expect(rows[0]?.actualStart).toBe("2026-11-10T17:00:00Z");
    expect(timesheetTotals(rows)).toEqual({ scheduled: 4, effective: 4, adjusted: 0 });
  });
  it("confirmed actual hours survive a later schedule change", () => {
    const rows = buildTimesheetRows([shift("a", "2026-11-10T18:00:00Z", "2026-11-10T22:00:00Z")],
      [{ shift_id: "a", actual_start: "2026-11-10T17:00:00Z", actual_end: "2026-11-10T22:30:00Z", confirmed: true, note: null }], from, to, "America/Los_Angeles");
    expect(rows[0]?.actualHours).toBe(5.5);
  });
  it("overnight shifts belong to their start date in the work time zone", () => {
    const rows = buildTimesheetRows([shift("a", "2026-11-11T06:00:00Z", "2026-11-11T15:00:00Z")], [], from, to, "America/Los_Angeles");
    expect(rows[0]?.workDate).toBe("2026-11-10");
  });
  it("removed shifts stay only when hours were confirmed", () => {
    const removed = [shift("a", "2026-11-10T17:00:00Z", "2026-11-10T21:00:00Z", "2026-11-12T00:00:00Z"), shift("b", "2026-11-11T17:00:00Z", "2026-11-11T21:00:00Z", "2026-11-12T00:00:00Z")];
    const rows = buildTimesheetRows(removed, [{ shift_id: "a", actual_start: "2026-11-10T17:00:00Z", actual_end: "2026-11-10T21:00:00Z", confirmed: true, note: null }], from, to, "UTC");
    expect(rows.map(r => r.shift.id)).toEqual(["a"]);
  });
  it("saved adjustment stays on its original work date after moving to another period", () => {
    const rows = buildTimesheetRows([shift("a", "2026-12-10T17:00:00Z", "2026-12-10T21:00:00Z")], [{ shift_id: "a", actual_start: "2026-11-10T17:00:00Z", actual_end: "2026-11-10T22:30:00Z", confirmed: true, work_date: "2026-11-10", note: null }], from, to, "America/Los_Angeles");
    expect(rows[0]?.workDate).toBe("2026-11-10");
    expect(timesheetTotals(rows).effective).toBe(5.5);
  });
});
