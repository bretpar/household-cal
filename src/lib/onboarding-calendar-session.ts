/** Browser-session continuation only, never authorization. Server calls still check ownership. */
const key = "ofc-onboarding-calendar-setup";
export function beginCalendarSetup(userId: string, familyId: string) {
  try { sessionStorage.setItem(key, JSON.stringify({ userId, familyId })); } catch { /* unavailable */ }
}
export function hasCalendarSetup(userId: string, familyId: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value?.userId === userId && value?.familyId === familyId;
  } catch { return false; }
}
export function finishCalendarSetup() {
  try { sessionStorage.removeItem(key); } catch { /* unavailable */ }
}