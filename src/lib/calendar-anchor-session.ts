import { getVerifiedMembership } from "@/lib/auth-guard";

/**
 * Session-level memory of the Calendar's selected date, kept above the route
 * so returning from another tab restores it. Keyed by verified user+household
 * so a date never carries across accounts or households; cleared on sign-out.
 */
const anchors = new Map<string, number>();

function scopeKey(): string | null {
  const m = getVerifiedMembership();
  return m ? `${m.userId}:${m.family_id}` : null;
}

export function readCalendarAnchor(): Date | null {
  const k = scopeKey();
  const t = k ? anchors.get(k) : undefined;
  return t === undefined ? null : new Date(t);
}

export function writeCalendarAnchor(date: Date): void {
  const k = scopeKey();
  if (k) anchors.set(k, date.getTime());
}

export function clearCalendarAnchors(): void {
  anchors.clear();
}
