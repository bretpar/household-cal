import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  createEvent,
  deleteEventFn,
  getFamilyBundle,
  updateEventFn,
} from "@/lib/calendar.functions";
import { refreshHouseholdCalendar } from "@/lib/google.functions";
import type { EventInput, RecurrenceScope } from "@/lib/calendar-ops";
import { clipboardFromOccurrence, type EventClipboard } from "@/lib/event-clipboard";
import {
  appearanceForEvent,
  eventMatchesCategory,
  resolvedCategoryId,
  UNCATEGORIZED_FILTER,
  type CategoryAppearance,
  type CategoryRef,
  type CategorySelection,
  type EventCategory,
} from "@/lib/event-categories";
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
  isCoverage,
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
  /** events narrowed by the active category filter (coverage layers always kept) */
  visibleEvents: CalendarEvent[];
  /** household categories, sorted; Uncategorized is not a row */
  categories: EventCategory[];
  /** category label + colour classes for an event's category_id (null = Uncategorized) */
  categoryAppearanceFor: (ref: CategoryRef) => CategoryAppearance;
  /** effective household category id for an event (legacy/stale-safe); null = Uncategorized */
  resolvedCategoryIdFor: (ref: CategoryRef) => string | null;

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

  /** null = all categories; UNCATEGORIZED_FILTER = events without a category */
  selectedCategory: CategorySelection;
  setSelectedCategory: (value: CategorySelection) => void;

  /** copied event held in memory only (cleared on refresh) */
  copiedEvent: EventClipboard | null;
  copyOccurrence: (occurrence: Occurrence) => void;
  clearCopiedEvent: () => void;
  /** day the user chose to paste onto; drives the prefilled add-event dialog */
  pasteDate: Date | null;
  startPaste: (day: Date) => void;
  cancelPaste: () => void;

  activeOccurrence: Occurrence | null;
  /** proposed new start from a touch drag, prefilled into the edit form (never saved automatically) */
  proposedStart: Date | null;
  openOccurrence: (occurrence: Occurrence, options?: { proposedStart?: Date }) => void;
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
  const refreshGoogle = useServerFn(refreshHouseholdCalendar);

  const [selectedMembers, setSelectedMembers] = useState<MemberId[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategorySelection>(null);
  const [active, setActive] = useState<{
    occurrence: Occurrence;
    proposedStart: Date | null;
  } | null>(null);
  const [copiedEvent, setCopiedEvent] = useState<EventClipboard | null>(null);
  const [pasteDate, setPasteDate] = useState<Date | null>(null);

  const bundle = useQuery({
    queryKey: FAMILY_BUNDLE_KEY,
    queryFn: () => fetchBundle(),
  });

  // App-open freshness: pull Google changes in the background (never blocking
  // render) and refetch the bundle only when something was actually imported.
  const openSyncRan = useRef(false);
  useEffect(() => {
    if (openSyncRan.current || !bundle.data?.family) return;
    openSyncRan.current = true;
    void refreshGoogle()
      .then((result) => {
        if (result && "applied" in result && (result.applied ?? 0) > 0) {
          queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
        }
      })
      .catch(() => {
        /* freshness sync is best-effort; the cached calendar stays usable */
      });
  }, [bundle.data?.family, refreshGoogle, queryClient]);

  // A category filter can point at a category that was just deleted in Family
  // settings. Drop the stale selection so the calendar never looks empty.
  const categories = bundle.data?.categories ?? [];
  const categoryMissing =
    !!selectedCategory &&
    selectedCategory !== UNCATEGORIZED_FILTER &&
    categories.length > 0 &&
    !categories.some((c) => c.id === selectedCategory);
  useEffect(() => {
    if (categoryMissing) setSelectedCategory(null);
  }, [categoryMissing]);
  const effectiveCategory: CategorySelection = categoryMissing ? null : selectedCategory;

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
      visibleEvents: (data?.events ?? []).filter(
        (event) =>
          isCoverage(event) || eventMatchesCategory(event, effectiveCategory, categories),
      ),
      categories: data?.categories ?? [],
      categoryAppearanceFor: (ref) => appearanceForEvent(data?.categories ?? [], ref),
      resolvedCategoryIdFor: (ref) => resolvedCategoryId(data?.categories ?? [], ref),

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

      selectedCategory: effectiveCategory,
      setSelectedCategory,

      copiedEvent,
      copyOccurrence: (occurrence) => setCopiedEvent(clipboardFromOccurrence(occurrence)),
      clearCopiedEvent: () => {
        setCopiedEvent(null);
        setPasteDate(null);
      },
      pasteDate,
      startPaste: setPasteDate,
      cancelPaste: () => setPasteDate(null),

      activeOccurrence: active?.occurrence ?? null,
      proposedStart: active?.proposedStart ?? null,
      openOccurrence: (occurrence, options) =>
        setActive({ occurrence, proposedStart: options?.proposedStart ?? null }),
      closeOccurrence: () => setActive(null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, bundle.isLoading, selectedMembers, effectiveCategory, active, copiedEvent, pasteDate]);

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarStore {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used inside CalendarProvider");
  return ctx;
}
