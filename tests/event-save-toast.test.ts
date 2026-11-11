import { beforeEach, describe, expect, it, vi } from "vitest";

const { success, error, loading } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => success(...args), {
    success,
    error,
    loading,
    message: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/google.functions", () => ({
  syncNow: vi.fn(async () => ({})),
}));

import { reportEventSaved } from "@/lib/google-sync-feedback";

describe("event save notification", () => {
  beforeEach(() => {
    success.mockClear();
    error.mockClear();
    loading.mockClear();
  });

  it("confirms a saved edit briefly and never shows a syncing toast while Google is pending", () => {
    reportEventSaved("Bailey mani/pedi updated", "pending");

    expect(loading).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith("Bailey mani/pedi updated", { duration: 2000 });
    expect(error).not.toHaveBeenCalled();
  });

  it("treats an already-synced or unmapped save the same way: one brief confirmation", () => {
    reportEventSaved("Bailey mani/pedi added to the family calendar", "synced");
    reportEventSaved("Bailey mani/pedi added to the family calendar", "unlinked");
    reportEventSaved("Bailey mani/pedi added to the family calendar", undefined);

    expect(loading).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(3);
    for (const call of success.mock.calls) {
      expect(call[1]).toEqual({ duration: 2000 });
    }
  });

  it("still reports a genuine Google failure, dismissibly, without a syncing toast", () => {
    reportEventSaved("Bailey mani/pedi updated", "failed");

    expect(loading).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    const [message, options] = error.mock.calls[0];
    expect(message).toContain("Google sync failed");
    expect(options.action.label).toBe("Retry");
    // Auto-expires rather than persisting; a finite duration is what makes it
    // dismissible on its own instead of stacking up.
    expect(options.duration).toBe(8000);
  });
});
