import { describe, expect, it } from "vitest";

import {
  defaultCalendarSourceId,
  draftFromFormState,
  emptyFormState,
} from "@/components/EventForm";

type Src = Parameters<typeof defaultCalendarSourceId>[0][number];

const src = (id: string, over: Partial<Src> = {}): Src => ({
  id,
  provider: "google",
  active: true,
  is_main: false,
  ...over,
});

describe("defaultCalendarSourceId", () => {
  it("picks the main active Google calendar", () => {
    const sources = [
      src("local", { provider: "local" as Src["provider"] }),
      src("g1"),
      src("g2", { is_main: true }),
    ];
    expect(defaultCalendarSourceId(sources)).toBe("g2");
  });

  it("falls back to the first active Google calendar when none is main", () => {
    expect(defaultCalendarSourceId([src("g1"), src("g2")])).toBe("g1");
  });

  it("ignores inactive Google calendars", () => {
    expect(defaultCalendarSourceId([src("g1", { active: false, is_main: true })])).toBeNull();
  });

  it("returns null when only local sources exist", () => {
    expect(defaultCalendarSourceId([src("local", { provider: "local" as Src["provider"] })])).toBeNull();
  });
});

describe("draftFromFormState calendar source", () => {
  const base = () => ({ ...emptyFormState(new Date(2026, 0, 5)), title: "Soccer" });

  it("uses the resolved default when the picker was never touched", () => {
    const state = base();
    expect(state.calendarSourceId).toBeNull();
    const sources = [src("g1"), src("g2", { is_main: true })];
    const draft = draftFromFormState(state, defaultCalendarSourceId(sources));
    expect(draft.calendar_source_id).toBe("g2");
  });

  it("preserves an explicit user selection", () => {
    const state = { ...base(), calendarSourceId: "g1" };
    const draft = draftFromFormState(state, "g2");
    expect(draft.calendar_source_id).toBe("g1");
  });

  it("keeps local-only behavior when no Google source is available", () => {
    const draft = draftFromFormState(base(), defaultCalendarSourceId([]));
    expect(draft.calendar_source_id).toBeNull();
  });
});
