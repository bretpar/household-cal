import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  buildSampleEvents,
  type CalendarEvent,
  type MemberId,
} from "./family-data";

interface CalendarStore {
  events: CalendarEvent[];
  addEvent: (event: Omit<CalendarEvent, "id" | "google_calendar_id" | "google_event_id">) => void;
  selectedMembers: MemberId[];
  toggleMember: (id: MemberId) => void;
  clearMembers: () => void;
}

const CalendarContext = createContext<CalendarStore | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<CalendarEvent[]>(() => buildSampleEvents());
  const [selectedMembers, setSelectedMembers] = useState<MemberId[]>([]);

  const value = useMemo<CalendarStore>(
    () => ({
      events,
      addEvent: (event) =>
        setEvents((prev) => [
          ...prev,
          {
            ...event,
            id: `ev-${Math.random().toString(36).slice(2, 9)}`,
            google_calendar_id: null,
            google_event_id: null,
          },
        ]),
      selectedMembers,
      toggleMember: (id) =>
        setSelectedMembers((prev) =>
          prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
        ),
      clearMembers: () => setSelectedMembers([]),
    }),
    [events, selectedMembers],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarStore {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used inside CalendarProvider");
  return ctx;
}
