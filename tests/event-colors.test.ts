import { describe, expect, it } from "vitest";

import {
  UNCATEGORIZED_ACCENT,
  UNCATEGORIZED_TINT,
  eventAccentClass,
  eventTintClass,
  isEveryoneAssigned,
} from "../src/lib/event-colors";
import { appearanceForEvent, type EventCategory } from "../src/lib/event-categories";

const categories: EventCategory[] = [
  { id: "cat-school", family_id: "f", name: "School", color: "sky", sort_order: 0 },
];

describe("event display colours", () => {
  it("uses the category appearance for a categorized event", () => {
    const appearance = appearanceForEvent(categories, "cat-school");
    expect(appearance.label).toBe("School");
    expect(eventTintClass(appearance)).toBe(appearance.soft);
    expect(eventAccentClass(appearance)).toBe(appearance.swatch);
    expect(eventTintClass(appearance)).not.toBe(UNCATEGORIZED_TINT);
  });

  it("falls back to the neutral Uncategorized appearance when category_id is null", () => {
    const appearance = appearanceForEvent(categories, null);
    expect(appearance.label).toBe("Uncategorized");
    expect(eventTintClass(appearance)).toBe(UNCATEGORIZED_TINT);
    expect(eventAccentClass(appearance)).toBe(UNCATEGORIZED_ACCENT);
  });

  it("stays neutral for a Google import pointing at a removed category", () => {
    expect(eventTintClass(appearanceForEvent(categories, "gone"))).toBe(UNCATEGORIZED_TINT);
    expect(eventTintClass(undefined)).toBe(UNCATEGORIZED_TINT);
    expect(eventAccentClass(null)).toBe(UNCATEGORIZED_ACCENT);
  });

  it("never blends member colours into the card — badges carry participation", () => {
    expect(isEveryoneAssigned(["b", "e"], 5)).toBe(false);
    expect(isEveryoneAssigned(["d", "m", "b", "e", "j"], 5)).toBe(true);
    expect(isEveryoneAssigned(["d", "m"], 2)).toBe(false);
  });
});
