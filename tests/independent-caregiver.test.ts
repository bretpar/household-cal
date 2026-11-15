import { describe, expect, it } from "vitest";
import { clientInput, shiftInput, scheduledHours, workEvents, type WorkShift } from "../src/lib/independent-caregiver";
const user = "00000000-0000-4000-8000-000000000001";
const client = "00000000-0000-4000-8000-000000000002";
const shift: WorkShift = { id: "00000000-0000-4000-8000-000000000003", user_id: user, client_id: client,
  start_at: "2026-12-31T23:00:00Z", end_at: "2027-01-01T02:00:00Z", notes: null, version: user, deleted_at: null };
describe("independent caregiver rules", () => {
  it("requires exactly one family contact", () => {
    expect(shiftInput.safeParse({ start_at: shift.start_at, end_at: shift.end_at }).success).toBe(false);
    expect(shiftInput.safeParse({ client_id: client, start_at: shift.start_at, end_at: shift.end_at }).success).toBe(true);
  });
  it("requires a family name but permits an omitted email", () => {
    expect(clientInput.safeParse({ name: "", color: "sky" }).success).toBe(false);
    expect(clientInput.safeParse({ name: "Parker", color: "sky" }).success).toBe(true);
  });
  it("keeps shift identity and assigned family in calendar adaptation", () => {
    const events = workEvents([shift], [{ id: client, name: "Parker", email: null, color: "rose", archived: false }]);
    expect(events[0]?.id).toBe(shift.id);
    expect(events[0]?.category_id).toBe(client);
    expect(events[0]?.source_color).toBe("rose");
  });
  it("counts only in-period scheduled hours and excludes deleted shifts", () => {
    expect(scheduledHours([shift], new Date("2026-12-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"))).toBe(1);
    expect(scheduledHours([{ ...shift, deleted_at: "2026-11-15T00:00:00Z" }], new Date("2026-12-01T00:00:00Z"), new Date("2027-02-01T00:00:00Z"))).toBe(0);
  });
  it("rejects nonpositive shift duration", () => {
    expect(shiftInput.safeParse({ client_id: client, start_at: shift.start_at, end_at: shift.start_at }).success).toBe(false);
  });
});