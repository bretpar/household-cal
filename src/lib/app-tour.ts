/** New accounts only: established users are always manual-only for this version. */
export const TOUR_VERSION = 1;
export const TOUR_LAUNCH_DATE = "2026-10-09T01:16:13Z";
export type TourStatus = "completed" | "dismissed";
export const tourStorageKey = (userId: string) => `ofc:app-tour:v${TOUR_VERSION}:${userId}`;

export function shouldAutoStartTour(createdAt: string, saved: string | null): boolean {
  return saved === null && Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) >= Date.parse(TOUR_LAUNCH_DATE);
}

export type TourRoute = "/today" | "/calendar" | "/activities" | "/timesheet" | "/settings" | "/family";

export interface TourStep {
  id: string;
  title: string;
  description: string;
  /** Page this tip lives on; consecutive tips on one page never navigate. */
  route: TourRoute;
  /** Spotlight anchors in priority order; the first visible one is used. */
  targets: string[];
}

export function tourSteps(caregiver: boolean, owner: boolean, timesheets: boolean): TourStep[] {
  if (caregiver) {
    const steps: TourStep[] = [
      { id: "today-schedule", route: "/today", targets: ["today-agenda", "/today"], title: "Today", description: "Your upcoming shifts and the family plans shared with you." },
      { id: "calendar-views", route: "/calendar", targets: ["calendar-views", "/calendar"], title: "Calendar", description: "Switch views and move between dates. Your access is read-only." },
    ];
    if (timesheets) steps.push({ id: "timesheet", route: "/timesheet", targets: ["/timesheet"], title: "Timesheet", description: "Review your actual hours and submit your time card." });
    steps.push({ id: "settings", route: "/settings", targets: ["/settings"], title: "Settings", description: "Your account and notification preferences. Replay this tour anytime." });
    return steps;
  }
  const steps: TourStep[] = [
    { id: "today-schedule", route: "/today", targets: ["today-agenda", "/today"], title: "Today's schedule", description: "Your family's upcoming plans at a glance." },
    { id: "people", route: "/today", targets: ["people"], title: "Family initials & colors", description: "Each initial and color is a family member, so you can see who's involved." },
    { id: "people-filter", route: "/today", targets: ["people-filter"], title: "Family filters", description: "Show or hide family members to focus on their plans." },
    { id: "calendar-views", route: "/calendar", targets: ["calendar-views", "/calendar"], title: "Calendar views", description: "Switch between Day, 3-Day, Week and Month." },
    { id: "calendar-events", route: "/calendar", targets: ["calendar-add", "/calendar"], title: "Events", description: "Tap any event to see details, or add a new one here." },
    { id: "activities", route: "/activities", targets: ["activities-recurring", "/activities"], title: "Activities", description: "Your family's recurring activities and their schedules." },
  ];
  if (owner && timesheets) steps.push({ id: "timesheets", route: "/activities", targets: ["activities-timesheets"], title: "Timesheets", description: "Review and confirm caregiver hours here." });
  steps.push({ id: "family", route: "/family", targets: ["/family"], title: "Settings", description: "Household members, notifications and calendar connections. Replay this tour under Account." });
  return steps;
}
