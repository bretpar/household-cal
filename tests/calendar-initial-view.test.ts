import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_CACHE_KEY,
  parseCachedPreferences,
  resolveInitialCalendarView,
} from "@/lib/calendar-initial-view";

describe("cached preferences are available on first paint", () => {
  it("reads a saved Day default out of the cache payload", () => {
    const raw = JSON.stringify({ weekStart: 1, defaultView: "day" });
    expect(PREFERENCES_CACHE_KEY).toBe("ofc:user-preferences");
    expect(parseCachedPreferences(raw)).toEqual({ weekStart: 1, defaultView: "day" });
  });

  it("ignores empty, malformed or unknown payloads", () => {
    expect(parseCachedPreferences(null)).toBeNull();
    expect(parseCachedPreferences("{")).toBeNull();
    expect(parseCachedPreferences(JSON.stringify({ defaultView: "year" }))).toBeNull();
  });

  it("fills missing fields from the defaults", () => {
    expect(parseCachedPreferences(JSON.stringify({ defaultView: "week" }))).toEqual({
      weekStart: DEFAULT_PREFERENCES.weekStart,
      defaultView: "week",
    });
  });
});

describe("resolveInitialCalendarView", () => {
  it("renders the saved Day view first, never Month", () => {
    for (const [isPhoneScreen, isLandscape] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      expect(
        resolveInitialCalendarView({ defaultView: "day", isPhoneScreen, isLandscape }),
      ).toBe("day");
    }
  });

  it("keeps a saved Week default on desktop and phone landscape", () => {
    expect(
      resolveInitialCalendarView({ defaultView: "week", isPhoneScreen: false, isLandscape: false }),
    ).toBe("week");
    expect(
      resolveInitialCalendarView({ defaultView: "week", isPhoneScreen: true, isLandscape: true }),
    ).toBe("week");
  });

  it("substitutes the portrait selection for a Week default on a portrait phone", () => {
    expect(
      resolveInitialCalendarView({
        defaultView: "week",
        isPhoneScreen: true,
        isLandscape: false,
        portraitView: "day",
      }),
    ).toBe("day");
  });

  it("falls back to the portrait selection until the preference is known", () => {
    expect(
      resolveInitialCalendarView({ defaultView: null, isPhoneScreen: true, isLandscape: false }),
    ).toBe("month");
  });
});
