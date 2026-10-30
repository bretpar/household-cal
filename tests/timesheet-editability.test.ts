import { describe, expect, it } from "vitest";
import { timesheetStatusRevalidated } from "../src/lib/timesheet-editability";

describe("Timesheet status revalidation", () => {
  it("does not allow cached navigation data to enable editing before a fresh result", () => {
    expect(timesheetStatusRevalidated({ isFetchedAfterMount: false, isSuccess: true, isFetching: false })).toBe(false);
  });

  it("keeps editing gated during a refresh of a previously confirmed sheet", () => {
    expect(timesheetStatusRevalidated({ isFetchedAfterMount: true, isSuccess: true, isFetching: true })).toBe(false);
  });

  it("does not unlock editing when revalidation fails", () => {
    expect(timesheetStatusRevalidated({ isFetchedAfterMount: true, isSuccess: false, isFetching: false })).toBe(false);
  });

  it("allows the existing sheet editability checks after successful revalidation", () => {
    expect(timesheetStatusRevalidated({ isFetchedAfterMount: true, isSuccess: true, isFetching: false })).toBe(true);
  });
});