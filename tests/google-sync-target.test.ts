import { describe, expect, it } from "vitest";

import {
  calendarNameChange,
  classifyGoogleFailure,
  sourceSyncPatch,
} from "@/lib/google/mapping";

describe("sync target availability", () => {
  it("keeps the same connection when the Google calendar is renamed", () => {
    // identity is the calendarId; only the label follows Google
    expect(calendarNameChange("Parker Family", "Parker Household")).toBe("Parker Household");
    expect(calendarNameChange("Parker Family", "Parker Family")).toBeNull();
    expect(calendarNameChange("Parker Family", null)).toBeNull();
  });

  it("classifies missing calendars, revoked access and transient failures apart", () => {
    expect(classifyGoogleFailure(404, '{"error":{"errors":[{"reason":"notFound"}]}}')).toBe(
      "calendar_unavailable",
    );
    expect(classifyGoogleFailure(410, "")).toBe("calendar_unavailable");
    expect(classifyGoogleFailure(403, '{"reason":"notFound"}')).toBe("calendar_unavailable");
    expect(classifyGoogleFailure(401, "invalid_grant")).toBe("auth");
    expect(classifyGoogleFailure(403, "insufficientPermissions")).toBe("auth");
    expect(classifyGoogleFailure(500, "backendError")).toBe("transient");
    expect(classifyGoogleFailure(429, "rateLimitExceeded")).toBe("transient");
  });

  it("pauses an unavailable calendar without mutating local data", () => {
    const patch = sourceSyncPatch({
      outcome: "unavailable",
      reason: "gone",
      failureCount: 0,
      now: "2026-08-25T00:00:00.000Z",
    });
    expect(patch.sync_status).toBe("needs_attention");
    expect(patch.sync_paused_at).toBe("2026-08-25T00:00:00.000Z");
    // never clears the calendar id or the event linkage
    expect(Object.keys(patch).sort()).toEqual([
      "sync_error",
      "sync_failure_count",
      "sync_paused_at",
      "sync_status",
    ]);
  });

  it("records transient failures for retry instead of pausing", () => {
    const patch = sourceSyncPatch({
      outcome: "transient",
      reason: "backendError",
      failureCount: 2,
      now: "2026-08-25T00:00:00.000Z",
    });
    expect(patch.sync_status).toBeUndefined();
    expect(patch.sync_failure_count).toBe(3);
  });

  it("clears attention state only on a successful pass", () => {
    expect(
      sourceSyncPatch({ outcome: "ok", failureCount: 4, now: "2026-08-25T00:00:00.000Z" }),
    ).toEqual({ sync_status: "active", sync_error: null, sync_failure_count: 0, sync_paused_at: null });
  });
});
