import { registerPlugin } from "@capacitor/core";

import { isNativeApp } from "@/lib/native-auth";
import { subscribeVerifiedMembership, getVerifiedMembership } from "@/lib/auth-guard";

type BadgePermission = "granted" | "denied" | "prompt" | "unavailable";
interface AppBadgePlugin {
  checkPermission(): Promise<{ badge: BadgePermission }>;
  requestPermission(): Promise<{ badge: BadgePermission }>;
  setCount(o: { count: number }): Promise<void>;
}
const AppBadge = registerPlugin<AppBadgePlugin>("AppBadge");

const PREF_KEY = "ofc-app-badge-enabled";
const listeners = new Set<() => void>();

export const appBadgeSupported = () => typeof window !== "undefined" && isNativeApp();

export function appBadgePreference(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(PREF_KEY) === "1"; } catch { return false; }
}
export function subscribeAppBadgePreference(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export async function appBadgePermission(): Promise<BadgePermission> {
  if (!appBadgeSupported()) return "unavailable";
  try { return (await AppBadge.checkPermission()).badge; } catch { return "unavailable"; }
}

/** Absolute count; 0 clears. Silent no-op on web or when the bridge is missing/denied. */
export async function setAppBadge(count: number): Promise<void> {
  if (!appBadgeSupported()) return;
  try { await AppBadge.setCount({ count: Math.max(0, Math.floor(count)) }); } catch { /* denied/unavailable */ }
}

/** Enabling asks for badge-only permission; returns the resulting state. */
export async function setAppBadgePreference(enabled: boolean): Promise<BadgePermission> {
  let state: BadgePermission = "unavailable";
  if (enabled && appBadgeSupported()) {
    try { state = (await AppBadge.requestPermission()).badge; } catch { state = "unavailable"; }
  }
  const on = enabled && state === "granted";
  try { window.localStorage.setItem(PREF_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  if (!on) await setAppBadge(0);
  listeners.forEach((l) => l());
  return enabled ? state : "prompt";
}

// Sign-out, account/household switch or access loss clears verified membership: clear the icon.
if (typeof window !== "undefined") {
  subscribeVerifiedMembership(() => {
    if (!getVerifiedMembership()) void setAppBadge(0);
  });
}
