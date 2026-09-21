import { describe, expect, it } from "vitest";

import { formatCompactTimeRange } from "@/lib/family-data";

function at(hour: number, minute = 0) {
  return new Date(2026, 8, 21, hour, minute, 0, 0);
}

describe("compact timeline time ranges", () => {
  it("uses one meridiem when both times share it", () => {
    expect(formatCompactTimeRange(at(10), at(11), false)).toBe("10–11a");
    expect(formatCompactTimeRange(at(15, 30), at(17), false)).toBe("3:30–5p");
  });

  it("keeps both meridiems when the range crosses noon or midnight", () => {
    expect(formatCompactTimeRange(at(9), at(13), false)).toBe("9a–1p");
    expect(formatCompactTimeRange(at(14), at(24), false)).toBe("2p–12a");
  });
});