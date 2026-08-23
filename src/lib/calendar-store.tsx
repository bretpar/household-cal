import { addDays, startOfDay } from "date-fns";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  buildSampleEvents,
  dayKey,
  getMember,
  type AccessLevel,
  type CalendarEvent,
  type MemberId,
  type Occurrence,
} from "./family-data";

/** Which slice of a recurring series an edit or delete applies to. Mirrors Google Calendar. */
export type RecurrenceScope = "this" | "future" | "series";

export type EventDraft = Omit<
  CalendarEvent,
  "id" | "google_calendar_id" | "google_event_id" | "recurrence_until" | "excluded_dates"
>;

interface CalendarStore {
  events: CalendarEvent[];
  addEvent: (event: EventDraft) => void;
  updateEvent: (occurrence: Occurrence, draft: EventDraft, scope: RecurrenceScope) => void;
  deleteEvent: (occurrence: Occurrence, scope: RecurrenceScope) => void;
  selectedMembers: MemberId[];
  toggleMember: (id: MemberId) => void;
  clearMembers: () => void;
  /** Signed-in family member — parents have full access, children are view-only. */
  currentMemberId: MemberId;
  access: AccessLevel;
  canEdit: boolean;
  setCurrentMemberId: (id: MemberId) => void;
  /** Event details sheet state, shared by every view. */
  activeOccurrence: Occurrence | null;
  openOccurrence: (occurrence: Occurrence) => void;
  closeOccurrence: () => void;
}

const CalendarContext = createContext<CalendarStore | null>(null);

const newId = () => `ev-${Math.random().toString(36).slice(2, 9)}`;

/** Move a draft's start/end onto the given day, preserving the draft's clock times. */
function shiftDraftToDay(draft: EventDraft, day: Date): EventDraft {
  const start = new Date(draft.start_at);
  const end = new Date(draft.end_at);
  const duration = end.getTime() - start.getTime();
  const nextStart = new Date(startOfDay(day));
  nextStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
  return {
    ...draft,
    start_at: nextStart.toISOString(),
    end_at: new Date(nextStart.getTime() + duration).toISOString(),
  };
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<CalendarEvent[]>(() => buildSampleEvents());
  const [selectedMembers, setSelectedMembers] = useState<MemberId[]>([]);
  const [currentMemberId, setCurrentMemberId] = useState<MemberId>("d");
  const [activeOccurrence, setActiveOccurrence] = useState<Occurrence | null>(null);

  const value = useMemo<CalendarStore>(() => {
    const access = getMember(currentMemberId).access;

    return {
      events,
      addEvent: (event) =>
        setEvents((prev) => [
          ...prev,
          { ...event, id: newId(), google_calendar_id: null, google_event_id: null },
        ]),

      updateEvent: (occurrence, draft, scope) =>
        setEvents((prev) => {
          const target = occurrence.event;
          const key = dayKey(occurrence.start);

          if (!target.recurrence_rule || scope === "series") {
            return prev.map((e) => (e.id === target.id ? { ...e, ...draft } : e));
          }

          if (scope === "this") {
            // detach a single occurrence: exclude it from the series, add a one-off event
            return [
              ...prev.map((e) =>
                e.id === target.id
                  ? { ...e, excluded_dates: [...(e.excluded_dates ?? []), key] }
                  : e,
              ),
              {
                ...draft,
                recurrence_rule: null,
                id: newId(),
                google_calendar_id: null,
                google_event_id: null,
              },
            ];
          }

          // "future": end the old series the day before, start a new one from here
          const until = dayKey(addDays(occurrence.start, -1));
          return [
            ...prev.map((e) => (e.id === target.id ? { ...e, recurrence_until: until } : e)),
            {
              ...shiftDraftToDay(draft, occurrence.start),
              id: newId(),
              google_calendar_id: null,
              google_event_id: null,
            },
          ];
        }),

      deleteEvent: (occurrence, scope) =>
        setEvents((prev) => {
          const target = occurrence.event;
          if (!target.recurrence_rule || scope === "series") {
            return prev.filter((e) => e.id !== target.id);
          }
          if (scope === "this") {
            return prev.map((e) =>
              e.id === target.id
                ? { ...e, excluded_dates: [...(e.excluded_dates ?? []), dayKey(occurrence.start)] }
                : e,
            );
          }
          const until = dayKey(addDays(occurrence.start, -1));
          return prev.map((e) => (e.id === target.id ? { ...e, recurrence_until: until } : e));
        }),

      selectedMembers,
      toggleMember: (id) =>
        setSelectedMembers((prev) =>
          prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
        ),
      clearMembers: () => setSelectedMembers([]),

      currentMemberId,
      access,
      canEdit: access === "full",
      setCurrentMemberId,

      activeOccurrence,
      openOccurrence: setActiveOccurrence,
      closeOccurrence: () => setActiveOccurrence(null),
    };
  }, [events, selectedMembers, currentMemberId, activeOccurrence]);

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarStore {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used inside CalendarProvider");
  return ctx;
}
