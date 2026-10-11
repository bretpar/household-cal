import { getVerifiedMembership, resetGuardForResume } from "@/lib/auth-guard";
import { readEventCache, writeEventCache, type EventCacheScope } from "@/lib/event-cache";
import { useAppResume } from "@/lib/use-app-resume";
import { withTimeout } from "@/lib/with-timeout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

/**
 * Outcome of an authoritative household save. `google_sync` reports whether the
 * outbound Google push finished ("synced"), is still running ("pending"), had
 * nothing to mirror ("unlinked") or genuinely failed ("failed") — the household
 * save itself is complete either way.
 */
export interface EventSaveResult {
  event_id: string;
  google_sync: "synced" | "pending" | "unlinked" | "failed";
}



interface CalendarStore {
  loading: boolean;
  /** first load failed and no events were ever loaded (not the same as "no events") */
  loadError: boolean;
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

  /** Resolves once the household save is authoritative; Google may still be syncing. */
  addEvent: (draft: EventDraft) => Promise<EventSaveResult>;
  updateEvent: (
    occurrence: Occurrence,
    draft: EventDraft,
    scope: RecurrenceScope,
  ) => Promise<EventSaveResult>;

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

  /** Views report the dates on screen so only that window of events is fetched. */
  setVisibleRange: (from: Date, to: Date) => void;

  /** set while events shown are the saved copy from a previous visit (ms timestamp) */
  cachedAt: number | null;
  /** a background refresh is running while events are already on screen */
  refreshing: boolean;
  /** a refresh failed while earlier events are still on screen */
  refreshFailed: boolean;
}

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Initial window matches the Today dashboard: today ±2 days (end exclusive +3). */
export function todayWindow(today = new Date()) {
  return {
    from: dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2)),
    to: dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)),
  };
}
const defaultRange = () => todayWindow();

/** Days of coverage added around a newly required window. */
const WINDOW_PAD = 7;
/** Prefetch the next window once visible dates come this close to the edge. */
const EDGE_DAYS = 2;
const addDaysLocal = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseKey = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function currentScope(): EventCacheScope | null {
  const m = getVerifiedMembership();
  return m ? { userId: m.userId, familyId: m.family_id, role: m.role } : null;
}
const sameScope = (a: EventCacheScope | null, b: EventCacheScope | null) =>
  !!a && !!b && a.userId === b.userId && a.familyId === b.familyId && a.role === b.role;

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
  const [range, setRange] = useState(defaultRange);

  // Views report their visible dates. The query window only changes when the
  // visible dates leave the loaded coverage; the new window is padded and
  // prefetched near the edge so day-by-day navigation never blanks events.
  // Each window is still its own query entry, so wrong dates never show.
  const prefetchRef = useRef<(r: { from: string; to: string }) => void>(() => {});
  const setVisibleRange = useCallback((from: Date, to: Date) => {
    const next = { from: dayKeyOf(from), to: dayKeyOf(to) };
    const padded = {
      from: dayKeyOf(addDaysLocal(from, -WINDOW_PAD)),
      to: dayKeyOf(addDaysLocal(to, WINDOW_PAD)),
    };
    setRange((prev) => {
      if (!(next.from >= prev.from && next.to <= prev.to)) {
        // The exact Today window stays unpadded so its persisted cache applies.
        const t = todayWindow();
        return t.from === next.from && t.to === next.to ? next : padded;
      }
      const nearEdge =
        next.from < dayKeyOf(addDaysLocal(parseKey(prev.from), EDGE_DAYS)) ||
        next.to > dayKeyOf(addDaysLocal(parseKey(prev.to), -EDGE_DAYS));
      if (nearEdge) queueMicrotask(() => prefetchRef.current(padded));
      return prev;
    });
  }, []);

  // Query identity is bound to the verified user + household + role, so a
  // different account or permission level can never share a cache entry.
  const scope = currentScope();
  const scopeKey = scope ? `${scope.userId}:${scope.familyId}:${scope.role ?? ""}` : "none";

  // Only the Today window is persisted; the saved copy paints instantly and is
  // marked stale (updatedAt 0) so the server refresh always runs right away.
  // Read lazily when the query entry is created (never memoized across
  // clears), so cleanup on sign-out/switch can't be undone by stale state.
  const isTodayWindow = (() => {
    const t = todayWindow();
    return t.from === range.from && t.to === range.to;
  })();
  const cachedRef = useRef<{ key: string; savedAt: number } | null>(null);
  const queryKey = [...FAMILY_BUNDLE_KEY, scopeKey, range.from, range.to] as const;
  const queryKeyStr = queryKey.join("|");

  // Bounded so a request stalled by iOS suspension can't hold the startup
  // screen forever; one retry, then the existing error/retry UI shows.
  const fetchWindow = async (win: { from: string; to: string }) => {
    const startScope = currentScope();
    const result = await withTimeout(fetchBundle({ data: win }), 20_000, "Calendar");
    // A late response for a different account/household/role is discarded
    // so it can never populate (or be saved under) another calendar.
    if (!sameScope(startScope, currentScope()) || result.family?.id !== startScope?.familyId) {
      throw new Error("Calendar scope changed");
    }
    const today = todayWindow();
    if (
      today.from === win.from &&
      today.to === win.to &&
      (result.family?.role ?? null) === startScope?.role
    ) {
      writeEventCache(startScope!, win, result);
    }
    return result;
  };
  prefetchRef.current = (win) => {
    if (!scope) return;
    void queryClient.prefetchQuery({
      queryKey: [...FAMILY_BUNDLE_KEY, scopeKey, win.from, win.to],
      queryFn: () => fetchWindow(win),
      staleTime: 5 * 60 * 1000,
    });
  };

  const bundle = useQuery({
    queryKey,
    enabled: !!scope,
    queryFn: () => fetchWindow(range),
    initialData: () => {
      if (!isTodayWindow || !scope) return undefined;
      const hit = readEventCache(scope, range, dayKeyOf(new Date()));
      cachedRef.current = hit ? { key: queryKeyStr, savedAt: hit.savedAt } : null;
      return hit?.bundle;
    },
    initialDataUpdatedAt: () => (cachedRef.current?.key === queryKeyStr ? 0 : undefined),
    retry: 1,
    // Foreground returns within this window reuse the populated in-memory
    // bundle instead of refetching on focus; explicit invalidations still
    // refetch immediately regardless of staleness.
    staleTime: 5 * 60 * 1000,
  });
  const cached = cachedRef.current?.key === queryKeyStr ? cachedRef.current : null;

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

  // Warm resume (e.g. iOS app reopened after a while): reset any stuck auth
  // check and refresh quietly. The loaded calendar stays on screen because
  // the bundle keeps its data while refetching; Google refresh stays best-effort.
  // Reconnection: revalidate quietly; displayed events stay until replaced.
  useEffect(() => {
    const onOnline = () => void queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queryClient]);

  useAppResume(() => {
    resetGuardForResume();
    void queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    if (!bundle.data?.family) return;
    void refreshGoogle()
      .then((result) => {
        if (result && "applied" in result && (result.applied ?? 0) > 0) {
          queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
        }
      })
      .catch(() => {});
  });

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
      loading: bundle.isPending && !bundle.isError,
      loadError: bundle.isError && !bundle.data,
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
        const result = await createMutation.mutateAsync(draft);
        return { event_id: result.id, google_sync: result.google_sync };
      },
      updateEvent: async (occurrence, draft, scope) => {
        const result = await updateMutation.mutateAsync({
          event_id: occurrence.event.id,
          occurrence_day: dayKey(occurrence.start),
          scope,
          input: {
            calendar_source_id: occurrence.event.calendar_source_id,
            ...draft,
          } as EventInput,
        });
        return { event_id: occurrence.event.id, google_sync: result.google_sync };
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

      setVisibleRange,

      cachedAt: cached && bundle.data && bundle.dataUpdatedAt === 0 ? cached.savedAt : null,
      refreshing: bundle.isFetching && !bundle.isLoading && !!bundle.data,
      refreshFailed: bundle.isError && !!bundle.data,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data, bundle.isLoading, bundle.isPending, bundle.isError, bundle.isFetching, bundle.dataUpdatedAt, cached, selectedMembers, effectiveCategory, active, copiedEvent, pasteDate]);

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarStore {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be used inside CalendarProvider");
  return ctx;
}
