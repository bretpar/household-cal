import { beforeEach, describe, expect, it } from "vitest";

import { parseCachedPreferences, resolveInitialCalendarView } from "@/lib/calendar-initial-view";
import {
  recordShellMount,
  recordShellUnmount,
  resetShellProbe,
  shellProbeSnapshot,
} from "@/lib/shell-remount-probe";

/**
 * Simulates arriving at Calendar from another bottom tab: the cached
 * preference must decide the very first rendered view, with no Month step.
 */
function firstCalendarPaint({
  cache,
  isPhoneScreen,
  isLandscape,
  portraitView,
}: {
  cache: string | null;
  isPhoneScreen: boolean;
  isLandscape: boolean;
  portraitView?: "month" | "day";
}) {
  const prefs = parseCachedPreferences(cache);
  return resolveInitialCalendarView({
    defaultView: prefs?.defaultView ?? null,
    isPhoneScreen,
    isLandscape,
    portraitView,
  });
}

describe("tapping Calendar from another tab", () => {
  const savedDay = JSON.stringify({ weekStart: 1, defaultView: "day" });

  it("renders the saved Day view on the first paint, never Month", () => {
    expect(
      firstCalendarPaint({ cache: savedDay, isPhoneScreen: true, isLandscape: false }),
    ).toBe("day");
    expect(
      firstCalendarPaint({ cache: savedDay, isPhoneScreen: true, isLandscape: true }),
    ).toBe("day");
    expect(
      firstCalendarPaint({ cache: savedDay, isPhoneScreen: false, isLandscape: false }),
    ).toBe("day");
  });

  it("keeps a saved Week default except on a portrait phone", () => {
    const savedWeek = JSON.stringify({ weekStart: 1, defaultView: "week" });
    expect(
      firstCalendarPaint({ cache: savedWeek, isPhoneScreen: false, isLandscape: false }),
    ).toBe("week");
    expect(
      firstCalendarPaint({
        cache: savedWeek,
        isPhoneScreen: true,
        isLandscape: false,
        portraitView: "day",
      }),
    ).toBe("day");
  });

  it("does not paint Month when the saved view is Day and the cache is written last", () => {
    // First visit has no cache yet -> portrait fallback; once the preference is
    // cached, entering Calendar from another tab paints Day immediately.
    expect(firstCalendarPaint({ cache: null, isPhoneScreen: true, isLandscape: false })).toBe(
      "month",
    );
    const paints = ["/today", "/activities", "/family"].map(() =>
      firstCalendarPaint({ cache: savedDay, isPhoneScreen: true, isLandscape: false }),
    );
    expect(paints).toEqual(["day", "day", "day"]);
    expect(paints).not.toContain("month");
  });
});

describe("shell remount probe", () => {
  beforeEach(() => resetShellProbe());

  it("stays quiet when the shell mounts once and survives tab changes", () => {
    expect(recordShellMount("bottom-nav", "/today", 1000)).toBeNull();
    expect(shellProbeSnapshot("bottom-nav").mounts).toBe(1);
  });

  it("flags a remount that happens across a tab transition", () => {
    recordShellMount("bottom-nav", "/today", 1000);
    recordShellUnmount("bottom-nav", "/today", 1100);
    const warning = recordShellMount("bottom-nav", "/calendar", 1150);
    expect(warning).toContain("bottom-nav remounted");
    expect(warning).toContain("/today -> /calendar");
  });

  it("ignores a remount long after the unmount (e.g. a fresh session)", () => {
    recordShellMount("header", "/today", 1000);
    recordShellUnmount("header", "/today", 1100);
    expect(recordShellMount("header", "/calendar", 60_000)).toBeNull();
  });
});
