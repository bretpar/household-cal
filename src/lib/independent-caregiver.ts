import { z } from "zod";
import type { CalendarEvent, MemberColor } from "@/lib/family-data";

export const clientInput = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160),
  email: z.union([z.literal(""), z.string().email()]).optional(),
  color: z.enum(["sky", "rose", "amber", "sage", "teal", "lilac", "coral", "sand"]),
});
export const shiftInput = z.object({
  id: z.string().uuid().optional(), version: z.string().uuid().optional(), client_id: z.string().uuid(),
  start_at: z.string().datetime({ offset: true }), end_at: z.string().datetime({ offset: true }),
  notes: z.string().max(10000).nullable().optional(),
}).refine(s => Date.parse(s.end_at) > Date.parse(s.start_at), "End time must be after start time");
export interface CaregiverClient { id: string; name: string; email: string | null; color: MemberColor; archived: boolean }
export interface WorkShift { id: string; user_id: string; client_id: string; start_at: string; end_at: string; notes: string | null; version: string; deleted_at: string | null }
export function workEvents(shifts: WorkShift[], clients: CaregiverClient[]): CalendarEvent[] {
  return shifts.filter(s => !s.deleted_at).map(s => {
    const client = clients.find(c => c.id === s.client_id);
    return { id: s.id, family_id: s.user_id, calendar_source_id: null, display_mode: "events", read_only: false,
      source_color: client?.color ?? "sky", source_name: client?.name ?? "Family", title: client?.name ?? "Family",
      start_at: s.start_at, end_at: s.end_at, all_day: false, location: null, notes: s.notes, event_type: "work",
      recurrence_rule: null, recurrence_until: null, excluded_dates: [], category_id: s.client_id,
      external_event_id: null, external_recurring_event_id: null, participants: [], member_ids: [], needs_family_assignment: false };
  });
}
export function scheduledHours(shifts: WorkShift[], from: Date, to: Date): number {
  return shifts.filter(s => !s.deleted_at).reduce((sum, s) => sum + Math.max(0,
    Math.min(Date.parse(s.end_at), to.getTime()) - Math.max(Date.parse(s.start_at), from.getTime())) / 3600000, 0);
}