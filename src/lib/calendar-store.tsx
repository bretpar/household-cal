import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  createEvent,
  deleteEventFn,
  getFamilyBundle,
  updateEventFn,
} from "@/lib/calendar.functions";
import type { EventInput, RecurrenceScope } from "@/lib/calendar-ops";
import {
  buildMemberStyles,
  dayKey,
  FALLBACK_MEMBER_STYLE,
  type CalendarEvent,
  type CalendarSource,
  type Family,
  type FamilyActivity,
  type FamilyMember,
  type MemberId,
  type MemberStyle,
  type Occurrence,
} from "./family-data";

export type { RecurrenceScope };

/** What the add/edit forms produce. The household and default calendar are resolved server-side. */
export type EventDraft = Omit<EventInput, "calendar_source_id"> & {
  calendar_source_id?: string | null;
};

interface CalendarStore {
  loading: boolean;
  family: Family | null;
  /** the signed-in user's role in the current household */
  role: Family["role"] | null;
  canEdit: boolean;
  isOwner: boolean;

  members: FamilyMember[];
  memberById: Record<MemberId, FamilyMember | undefined>;
  memberStyles: Record<MemberId, MemberStyle>;
  styleFor: (id: MemberId) => MemberStyle;
  sources: CalendarSource[];
  activities: FamilyActivity[];
  events: CalendarEvent[];

  addEvent: (draft: EventDraft) => Promise<void>;
  updateEvent: (
    occurrence: Occurrence,
    draft: EventDraft,
    scope: RecurrenceScope,
  ) => Promise<void>;
  deleteEvent: (occurrence: Occurrence, scope: RecurrenceScope) => Promise<void>;

  selectedMembers: MemberId[];
  toggleMember: (id: MemberId) => void;
  clearMembers: () => void;

  activeOccurrence: Occurrence | null;
  openOccurrence: (occurrence: Occurrence) => void;
  closeOccurrence: () => void;
}

const CalendarContext = createContext<CalendarStore | null>(null);

export const FAMILY_BUNDLE_KEY = ["family-bundle"] as const;

export function CalendarProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const fetchBundle = useServerFn(getFamilyBundle);
  const create = useServerFn(createEvent);
  const update = useServerFn(updateEventFn);
  const remove = useServerFn(deleteEventFn);

  const [selectedMembers, setSelectedMembers] = useState<MemberId[]>([]);
  const [activeOccurrence, setActiveOccurrence] = useState<Occurrence | null>(null);

  const bundle = useQuery({
    queryKey: FAMILY_BUNDLE_KEY,
    queryFn: () => fetchBundle(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });

  const createMutation = useMutation({
    mutationFn: (draft: EventDraft) =>
      create({ data: { calendar_source_id: null, ...draft } as EventInput }),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (vars: {
      event_id: string;
      occurrence_day: string;
      scope: RecurrenceScope;
      input: EventInput;
    }) => update({ data: vars }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (vars: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) =>
      remove({ data: vars }),
    onSuccess: invalidate,
  });

  const value = useMemo<CalendarStore>(() => {
    const data = bundle.data;
    const members = data?.members ?? [];
    const memberStyles = buildMemberStyles(members);
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const role = data?.family?.role ?? null;

    return {
      loading: bundle.isLoading,
      family: data?.family ?? null,
      role,
      canEdit: role === "owner" || role === "editor",
      isOwner: role === "owner",

      members,
      memberById,
      memberStyles,
      styleFor: (id) => memberStyles[id] ?? FALLBACK_MEMBER_STYLE,
      sources: data?.sources ?? [],
      activities: data?.activities ?? [],
      events: data?.events ?? [],

      addEvent: async (draft) => {
        await createMutation.mutateAsync(draft);
      },
      updateEvent: async (occurrence, draft, scope) => {
        await updateMutation.mutateAsync({
          event_id: occurrence.event.id,
          occurrence_day: dayKey(occurrence.start),
          scope,
          input: {
            calendar_source_id: occurrence.event.calendar_source_id,
            ...draft,
          } as EventInput,
        });
      },
      deleteEvent: async (occurrence, scope) => {
        await deleteMutation.mutateAsync({
          event_id: occurrence.event.id,
          occurrence_day: dayKey(occurrence.start),
          scope,
        });
      },

      selectedMembers,
      toggleMember: (id) =>
        setSelectedMembers((prev) =>
          prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
        ),
      clearMembers: () => setSelectedMembers([]),

      activeOccurrence,
      openOccurrence: setActiveOccurrence,
      closeOccurrence: () => setActiveOccurrence(null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, bundle.isLoading, selectedMembers, activeOccurrence]);

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarStore {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used inside CalendarProvider");
  return ctx;
}
