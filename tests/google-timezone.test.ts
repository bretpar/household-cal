import { describe, expect, it } from "vitest";

import { isIanaTimeZone, normalizeTimeZone, timeZoneAction } from "../src/lib/google/timezone";

describe("household timezone validation", () => {
  it("accepts IANA zones", () => {
    expect(isIanaTimeZone("America/Los_Angeles")).toBe(true);
    expect(isIanaTimeZone("Europe/Berlin")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects fixed offsets that cannot express DST", () => {
    for (const bad of ["GMT-8", "GMT+02:00", "-08:00", "Etc/GMT+8", "", null, "PST"]) {
      expect(isIanaTimeZone(bad)).toBe(false);
    }
  });

  it("falls back to a real zone", () => {
    expect(normalizeTimeZone("GMT-8")).toBe("America/Los_Angeles");
    expect(normalizeTimeZone("Europe/Paris")).toBe("Europe/Paris");
  });
});

describe("google calendar timezone reconciliation", () => {
  const household = "America/Los_Angeles";

  it("does nothing when the calendar already matches", () => {
    expect(
      timeZoneAction({ householdTimeZone: household, googleTimeZone: household, appManaged: true }),
    ).toEqual({ kind: "ok" });
  });

  it("does nothing when Google reported no timezone", () => {
    expect(
      timeZoneAction({ householdTimeZone: household, googleTimeZone: null, appManaged: false }),
    ).toEqual({ kind: "ok" });
  });

  it("auto-corrects app-managed calendars", () => {
    expect(
      timeZoneAction({
        householdTimeZone: household,
        googleTimeZone: "Etc/GMT+8",
        appManaged: true,
      }),
    ).toEqual({ kind: "update", timeZone: household });
  });

  it("warns instead of rewriting external calendars", () => {
    expect(
      timeZoneAction({
        householdTimeZone: household,
        googleTimeZone: "America/New_York",
        appManaged: false,
      }),
    ).toEqual({
      kind: "warn",
      googleTimeZone: "America/New_York",
      householdTimeZone: household,
    });
  });
});
