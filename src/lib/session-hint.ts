import { supabase } from "@/integrations/supabase/client";

/**
 * Synchronous, best-effort answer to "is there a persisted session?".
 *
 * Reads the Supabase auth token straight out of localStorage so public routes
 * can decide to redirect before their first paint, instead of flashing the
 * landing page while the async session check resolves.
 */
export function hasCachedSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        access_token?: string;
        expires_at?: number;
      } | null;
      if (!parsed?.access_token) continue;
      // A stale token still means "signed in" — the client refreshes it.
      if (typeof parsed.expires_at === "number") {
        const graceSeconds = 60 * 60 * 24 * 30;
        if (parsed.expires_at + graceSeconds < Date.now() / 1000) continue;
      }
      return true;
    }
  } catch {
    // Storage unavailable (private mode / brokered preview storage) — fall back
    // to the async check.
  }
  return false;
}

let cachedStatus: boolean | undefined;
let inFlight: Promise<boolean> | undefined;

/** Resolved session status, cached for the lifetime of the page. */
export function getSessionStatus(): Promise<boolean> {
  if (cachedStatus !== undefined) return Promise.resolve(cachedStatus);
  if (!inFlight) {
    inFlight = supabase.auth
      .getSession()
      .then(({ data }) => {
        cachedStatus = Boolean(data.session);
        return cachedStatus;
      })
      .catch(() => {
        cachedStatus = false;
        return false;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }
  return inFlight;
}

/** Cached value if already known, otherwise undefined. */
export function peekSessionStatus(): boolean | undefined {
  return cachedStatus;
}

export function setSessionStatus(value: boolean) {
  cachedStatus = value;
}
