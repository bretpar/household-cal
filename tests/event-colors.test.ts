import { describe, expect, it } from "vitest";

import {
  SHARED_ACCENT,
  SHARED_TINT,
  UNASSIGNED_ACCENT,
  UNASSIGNED_TINT,
  eventAccentClass,
  eventTintClass,
  isEveryoneAssigned,
} from "../src/lib/event-colors";

const styleFor = (id: string) =>
  ({
    soft: `bg-${id}-soft`,
    dot: `bg-${id}`,
    badge: `bg-${id}`,
    ring: `ring-${id}`,
  }) as never;

describe("event display colours", () => {
  it("uses the member's own tint for a solo event", () => {
    expect(eventTintClass(["bailey"], styleFor)).toBe("bg-bailey-soft");
    expect(eventAccentClass(["ellison"], styleFor)).toBe("bg-ellison");
  });

  it("uses one shared neutral for 2+ members regardless of order", () => {
    expect(eventTintClass(["bailey", "ellison"], styleFor)).toBe(SHARED_TINT);
    expect(eventTintClass(["ellison", "bailey"], styleFor)).toBe(SHARED_TINT);
    expect(eventTintClass(["ellison", "jack"], styleFor)).toBe(SHARED_TINT);
    expect(eventAccentClass(["ellison", "jack"], styleFor)).toBe(SHARED_ACCENT);
  });

  it("treats duplicate ids as a single member", () => {
    expect(eventTintClass(["bailey", "bailey"], styleFor)).toBe("bg-bailey-soft");
  });

  it("keeps the unassigned neutral when nobody is assigned", () => {
    expect(eventTintClass([], styleFor)).toBe(UNASSIGNED_TINT);
    expect(eventAccentClass([], styleFor)).toBe(UNASSIGNED_ACCENT);
  });

  it("collapses to an All indicator only when the whole family is on it", () => {
    expect(isEveryoneAssigned(["d", "m", "b", "e", "j"], 5)).toBe(true);
    expect(isEveryoneAssigned(["b", "e"], 5)).toBe(false);
    expect(isEveryoneAssigned(["d", "m"], 2)).toBe(false);
  });
});
