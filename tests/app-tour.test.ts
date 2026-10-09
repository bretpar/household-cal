import { describe, expect, it } from "vitest";
import { shouldAutoStartTour, tourSteps, tourStorageKey } from "@/lib/app-tour";

describe("app tour eligibility", () => {
  it("keeps existing accounts manual-only", () => {
    expect(shouldAutoStartTour("2026-10-08T18:00:00Z", null)).toBe(false);
  });
  it("offers new accounts a first-login tour", () => {
    expect(shouldAutoStartTour("2026-10-10T10:00:00Z", null)).toBe(true);
  });
  it("does not automatically repeat completed or dismissed tours", () => {
    for (const status of ["completed", "dismissed"]) {
      expect(shouldAutoStartTour("2026-10-10T10:00:00Z", JSON.stringify({ status }))).toBe(false);
    }
  });
  it("fails closed when account age is unknown", () => {
    expect(shouldAutoStartTour("unknown", null)).toBe(false);
  });
  it("isolates versioned state per user", () => {
    expect(tourStorageKey("dad")).toBe("ofc:app-tour:v1:dad");
    expect(tourStorageKey("mom")).not.toBe(tourStorageKey("dad"));
  });
});

describe("simple bottom-navigation tour", () => {
  it("uses exactly four steps for every access combination", () => {
    for (const caregiver of [true, false]) {
      for (const owner of [true, false]) {
        for (const timesheets of [true, false]) {
          expect(tourSteps(caregiver, owner, timesheets).map((s) => s.id)).toEqual(["today", "calendar", "activities", "settings"]);
        }
      }
    }
  });
  it("highlights only the four existing parent tabs", () => {
    expect(tourSteps(false, true, true).map((s) => s.tab)).toEqual(["/today", "/calendar", "/activities", "/family"]);
  });
  it("never highlights parent-only tabs for caregivers", () => {
    expect(tourSteps(true, false, true).map((s) => s.tab)).toEqual(["/today", "/calendar", "/timesheet", "/settings"]);
  });
  it("does not highlight an unavailable caregiver Timesheet tab", () => {
    expect(tourSteps(true, false, false).map((s) => s.tab)).toEqual(["/today", "/calendar", "/calendar", "/settings"]);
  });
});
