import type { FamilyBundle } from "@/lib/calendar-ops";

/**
 * Persisted copy of the Today window (today -2 .. +3, device-local dates) so a
 * reopened app can paint the last authorized events instantly while the server
 * refresh runs. Only ever holds the bundle the server returned for this exact
 * user + household + role (already RLS/caregiver-sanitized). It is a display
 * accelerator, never a substitute for authentication or membership checks.
 */
const STORAGE_KEY = "ofc-event-cache:v1";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface EventCacheScope {
  userId: string;
  familyId: string;
  role: string | null;
}

interface CachedEntry extends EventCacheScope {
  from: string;
  to: string;
  savedAt: number;
  bundle: FamilyBundle;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readEventCache(
  scope: EventCacheScope | null,
  range: { from: string; to: string },
  /** Today's date key; a saved window from an earlier day is reused if it still covers it. */
  anchor?: string,
): { bundle: FamilyBundle; savedAt: number } | null {
  const store = storage();
  if (!store || !scope) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    const covers = anchor
      ? entry.from <= anchor && anchor < entry.to
      : entry.from === range.from && entry.to === range.to;
    const matches =
      entry.userId === scope.userId &&
      entry.familyId === scope.familyId &&
      entry.role === scope.role &&
      covers &&
      Date.now() - entry.savedAt < MAX_AGE_MS &&
      entry.bundle?.family?.id === scope.familyId;
    if (!matches) {
      // Different account, household, permissions or day: never show it.
      if (entry.userId !== scope.userId || entry.familyId !== scope.familyId || entry.role !== scope.role) {
        store.removeItem(STORAGE_KEY);
      }
      return null;
    }
    return { bundle: entry.bundle, savedAt: entry.savedAt };
  } catch {
    store.removeItem(STORAGE_KEY);
    return null;
  }
}

export function writeEventCache(
  scope: EventCacheScope,
  range: { from: string; to: string },
  bundle: FamilyBundle,
) {
  const store = storage();
  if (!store || bundle.family?.id !== scope.familyId) return;
  const entry: CachedEntry = { ...scope, ...range, savedAt: Date.now(), bundle };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* quota or private mode: caching is best-effort */
  }
}

export function clearEventCache() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
