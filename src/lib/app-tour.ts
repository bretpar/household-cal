/** New accounts only: established users are always manual-only for this version. */
export const TOUR_VERSION = 1;
export const TOUR_LAUNCH_DATE = "2026-10-09T01:16:13Z";
export type TourStatus = "completed" | "dismissed";
export const tourStorageKey = (userId: string) => `ofc:app-tour:v${TOUR_VERSION}:${userId}`;

export function shouldAutoStartTour(createdAt: string, saved: string | null): boolean {
  return saved === null && Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) >= Date.parse(TOUR_LAUNCH_DATE);
}

export interface TourStep {
  id: string;
  title: string;
  description: string;
  /** Existing bottom tab to highlight, never a navigation destination. */
  tab: "/today" | "/calendar" | "/activities" | "/timesheet" | "/settings" | "/family";
}

export function tourSteps(caregiver: boolean, owner: boolean, timesheets: boolean): TourStep[] {
  return [
    { id: "today", tab: "/today", title: "Today", description: caregiver
      ? "Your upcoming shifts and shared family plans for the next three days."
      : "Your family's upcoming three-day schedule, with everyone's plans together." },
    { id: "calendar", tab: "/calendar", title: "Calendar", description: caregiver
      ? "Browse shared plans by date in Day, 3-Day, Week or Month. Your access is read-only."
      : "Browse your family's plans in Day, 3-Day, Week or Month." },
    { id: "activities", tab: caregiver ? timesheets ? "/timesheet" : "/calendar" : "/activities", title: caregiver ? timesheets ? "Timesheet" : "Shared plans" : owner && timesheets ? "Activities & Timesheets" : "Activities", description: caregiver
      ? timesheets ? "Review your actual hours and submit your time card." : "The Calendar shows only the family plans shared with you."
      : owner && timesheets ? "Find recurring activities and review caregiver time cards." : "Find your family's recurring activities and their schedules." },
    { id: "settings", tab: caregiver ? "/settings" : "/family", title: "Settings", description: caregiver
      ? "Your account and notification preferences. Replay this tour under Account."
      : "Household members, notifications and calendar connections. Replay this tour under Account." },
  ];
}
