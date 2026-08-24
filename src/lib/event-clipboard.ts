/**
 * In-memory "copied event" clipboard shape. Deliberately date-free: pasting
 * always uses the newly chosen day and keeps the copied times.
 * Lives in its own module so the store never imports form components.
 */
import { format } from "date-fns";

import type { EventType, MemberId, Occurrence } from "@/lib/family-data";

export interface EventClipboard {
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  members: MemberId[];
  eventType: EventType;
  location: string;
  notes: string;
  calendar_source_id: string | null;
}

/** A single occurrence of a series copies as a one-off event, never as a new series. */
export function clipboardFromOccurrence(occurrence: Occurrence): EventClipboard {
  const { event, start, end } = occurrence;
  return {
    title: event.title,
    startTime: format(start, "HH:mm"),
    endTime: format(end, "HH:mm"),
    allDay: event.all_day,
    members: [...event.member_ids],
    eventType: event.event_type,
    location: event.location ?? "",
    notes: event.notes ?? "",
    calendar_source_id: event.calendar_source_id ?? null,
  };
}
