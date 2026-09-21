/** Icon key -> component map for calendar appearance. Client-side only. */
import {
  Baby,
  Briefcase,
  Cake,
  CalendarDays,
  Car,
  GraduationCap,
  Heart,
  Home,
  Plane,
  Star,
  Stethoscope,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { isCalendarIconKey, type CalendarIconKey } from "@/lib/calendar-appearance";

export const CALENDAR_ICON_COMPONENTS: Record<CalendarIconKey, LucideIcon> = {
  work: Briefcase,
  medical: Stethoscope,
  school: GraduationCap,
  sports: Trophy,
  car: Car,
  home: Home,
  sitter: Baby,
  travel: Plane,
  birthday: Cake,
  family: Heart,
  star: Star,
  calendar: CalendarDays,
};

/** null when the calendar has no icon (or an unknown stored value). */
export function calendarIconComponent(key: unknown): LucideIcon | null {
  return isCalendarIconKey(key) ? CALENDAR_ICON_COMPONENTS[key] : null;
}
