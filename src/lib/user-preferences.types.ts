/** date-fns weekStartsOn value: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;
export type CalendarViewMode = "month" | "week" | "day";

export interface UserPreferences {
  weekStart: WeekStart;
  defaultView: CalendarViewMode;
}
