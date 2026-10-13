import { getVerifiedMembership } from "@/lib/auth-guard";

/**
 * In-memory, session-only memory of the caregiver Timesheet's selected pay
 * period and unsaved editor drafts, so a round-trip to Calendar restores them.
 * Keyed by verified user+household; never persisted or saved to the server;
 * cleared on sign-out.
 */
export type TimesheetDraft = { date: string; start: string; end: string; note: string };

type ScopeState = { period?: string; drafts: Map<string, TimesheetDraft> };
const scopes = new Map<string, ScopeState>();

function scope(): ScopeState | null {
  const m = getVerifiedMembership();
  if (!m) return null;
  const k = `${m.userId}:${m.family_id}`;
  let s = scopes.get(k);
  if (!s) scopes.set(k, (s = { drafts: new Map() }));
  return s;
}

export const draftKey = (timesheetId: string, entryId: string | null | undefined) =>
  `${timesheetId}:${entryId ?? "new"}`;

export function readTimesheetPeriod(): string | undefined {
  return scope()?.period;
}
export function writeTimesheetPeriod(periodStart: string): void {
  const s = scope();
  if (s) s.period = periodStart;
}
export function readTimesheetDraft(key: string): TimesheetDraft | undefined {
  return scope()?.drafts.get(key);
}
export function writeTimesheetDraft(key: string, draft: TimesheetDraft): void {
  scope()?.drafts.set(key, draft);
}
export function clearTimesheetDraft(key: string): void {
  scope()?.drafts.delete(key);
}
export function clearTimesheetSessions(): void {
  scopes.clear();
}
