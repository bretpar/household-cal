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
}

export function tourSteps(caregiver: boolean, owner: boolean, timesheets: boolean): TourStep[] {
  const steps: TourStep[] = [
    { id: "/today", title: "Today", description: caregiver ? "Your upcoming shifts and the family schedule shared with you." : "See your family's upcoming plans at a glance." },
    { id: "/calendar", title: "Calendar", description: caregiver ? "Browse your shared schedule. Your calendar access is read-only." : "Browse your family's schedule in Month, Week or Day view." },
  ];
  if (!caregiver) {
    steps.push({ id: "people", title: "Family initials & colors", description: "Each initial and color represents a family member. Use these filters to focus on their plans." });
    steps.push({ id: "/activities", title: owner && timesheets ? "Activities & Timesheets" : "Activities", description: owner && timesheets ? "Find recurring activities and review caregiver time cards here." : "Find your family's recurring activities here." });
  } else if (timesheets) {
    steps.push({ id: "/timesheet", title: "Timesheet", description: "Check your hours and submit your time card for review." });
  }
  steps.push({ id: caregiver ? "/settings" : "/family", title: "Settings", description: caregiver ? "Find your account settings here. You can replay this tour anytime." : "The Family tab opens Settings: household, calendars and your account. Replay this tour under Account." });
  return steps;
}