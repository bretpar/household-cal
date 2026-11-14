import { describe, expect, it } from "vitest";
import { canBuildSchedule } from "@/lib/schedule-builder";

/**
 * The Babysitter Schedule workspace is open to household Owners and Editors
 * (Activities shows the card to anyone with canEdit; the server functions and
 * the database policies accept both roles). Viewers and caregivers stay out.
 */
describe("canBuildSchedule", () => {
  it("allows owners and editors", () => {
    expect(canBuildSchedule("owner")).toBe(true);
    expect(canBuildSchedule("editor")).toBe(true);
  });

  it("rejects viewers, caregivers and unknown roles", () => {
    expect(canBuildSchedule("viewer")).toBe(false);
    expect(canBuildSchedule(null)).toBe(false);
    expect(canBuildSchedule(undefined)).toBe(false);
    expect(canBuildSchedule("caregiver" as never)).toBe(false);
  });
});
