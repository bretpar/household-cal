import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  native: true,
  scope: { userId: "owner-1", family_id: "family-1", role: "owner" } as { userId: string; family_id: string; role: string } | null,
  checkPermission: vi.fn(),
  setCount: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => state }));
vi.mock("@/lib/native-auth", () => ({ isNativeApp: () => state.native }));
vi.mock("@/lib/auth-guard", () => ({
  getVerifiedMembership: () => state.scope,
  subscribeVerifiedMembership: vi.fn(),
}));

import { reconcileAppBadge } from "@/lib/app-badge";

describe("absolute native review badge reconciliation", () => {
  let preference = "1";
  beforeEach(() => {
    vi.clearAllMocks();
    preference = "1";
    state.native = true;
    state.scope = { userId: "owner-1", family_id: "family-1", role: "owner" };
    state.checkPermission.mockResolvedValue({ badge: "granted" });
    state.setCount.mockResolvedValue(undefined);
    vi.stubGlobal("window", { localStorage: { getItem: () => preference } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rechecks permission and reapplies an unchanged absolute count on each resume", async () => {
    await reconcileAppBadge(123, () => true);
    await reconcileAppBadge(123, () => true);
    expect(state.checkPermission).toHaveBeenCalledTimes(2);
    expect(state.setCount.mock.calls).toEqual([[{ count: 123 }], [{ count: 123 }]]);
  });

  it("clears on denial and restores the same count when permission is restored", async () => {
    state.checkPermission.mockResolvedValueOnce({ badge: "denied" });
    await reconcileAppBadge(7, () => true);
    await reconcileAppBadge(7, () => true);
    expect(state.setCount.mock.calls).toEqual([[{ count: 0 }], [{ count: 7 }]]);
  });

  it("clears when the local preference is disabled", async () => {
    preference = "0";
    await reconcileAppBadge(7, () => true);
    expect(state.setCount).toHaveBeenCalledWith({ count: 0 });
  });

  it.each(["editor", "viewer"])("never applies an Owner count for %s", async (role) => {
    state.scope = { userId: "other", family_id: "family-1", role };
    await reconcileAppBadge(7, () => true);
    expect(state.setCount).toHaveBeenCalledWith({ count: 0 });
  });

  it.each(["sign-out", "household switch"])("discards an in-flight count after %s", async (change) => {
    state.checkPermission.mockImplementationOnce(async () => {
      state.scope = change === "sign-out" ? null : { userId: "owner-1", family_id: "family-2", role: "owner" };
      return { badge: "granted" };
    });
    await reconcileAppBadge(7, () => true);
    expect(state.setCount).not.toHaveBeenCalled();
  });

  it("discards an obsolete render's reconciliation", async () => {
    await reconcileAppBadge(7, () => false);
    expect(state.setCount).not.toHaveBeenCalled();
  });

  it("fails closed if system settings cannot be read", async () => {
    state.checkPermission.mockRejectedValueOnce(new Error("bridge unavailable"));
    await reconcileAppBadge(7, () => true);
    expect(state.setCount).toHaveBeenCalledWith({ count: 0 });
  });

  it("does not call native plugins on web", async () => {
    state.native = false;
    await reconcileAppBadge(7, () => true);
    expect(state.checkPermission).not.toHaveBeenCalled();
    expect(state.setCount).not.toHaveBeenCalled();
  });
});