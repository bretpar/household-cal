import { useState, type ReactNode } from "react";
import { CalendarStoreAdapter, type EventDraft } from "@/lib/calendar-store";
import { styleForColor, FALLBACK_MEMBER_STYLE, type Occurrence } from "@/lib/family-data";
import type { CategoryRef } from "@/lib/event-categories";
import { workEvents, type CaregiverClient, type WorkShift } from "./independent-caregiver";

export function CaregiverCalendarStore({ clients, shifts, timezone, children, openShift, moveShift }: {
  clients: CaregiverClient[]; shifts: WorkShift[]; timezone: string; children: ReactNode;
  openShift: (shift: WorkShift) => void; moveShift: (shift: WorkShift, draft: EventDraft) => Promise<void>;
}) {
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const events = workEvents(shifts, clients, timezone);
  const appearance = (ref: CategoryRef) => {
    const id = typeof ref === "string" ? ref : ref?.category_id;
    const client = clients.find(c => c.id === id);
    const style = styleForColor(client?.color);
    return { label: client?.name ?? "Family", swatch: style.dot, soft: style.soft };
  };
  const unsupported = async (): Promise<never> => { throw new Error("Use the work shift editor"); };
  const updateEvent = async (occurrence: Occurrence, draft: EventDraft) => {
    const shift = shifts.find(s => s.id === occurrence.event.id);
    if (!shift) throw new Error("Reload the shift before moving it");
    await moveShift(shift, draft);
    return { event_id: shift.id, google_sync: "pending" as const };
  };
  return <CalendarStoreAdapter value={{
    workTimeZone: timezone,
    loading: false, loadError: false, family: null, role: null, canEdit: true, isOwner: false,
    members: [], memberById: {}, memberStyles: {}, styleFor: () => FALLBACK_MEMBER_STYLE, sources: [], activities: [],
    events, visibleEvents: selectedCategory ? events.filter(e => e.category_id === selectedCategory) : events,
    categories: clients.map((c, i) => ({ id: c.id, family_id: "", name: c.name, color: c.color, sort_order: i })),
    categoryAppearanceFor: appearance, resolvedCategoryIdFor: ref => typeof ref === "string" ? ref : ref?.category_id ?? null,
    addEvent: unsupported, updateEvent, deleteEvent: unsupported,
    selectedMembers, toggleMember: id => setSelectedMembers(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]), clearMembers: () => setSelectedMembers([]),
    selectedCategory, setSelectedCategory, copiedEvent: null, copyOccurrence: () => {}, clearCopiedEvent: () => {},
    pasteDate: null, startPaste: () => {}, cancelPaste: () => {}, activeOccurrence: null, proposedStart: null,
    openOccurrence: o => { const shift = shifts.find(s => s.id === o.event.id); if (shift) openShift(shift); }, closeOccurrence: () => {},
    setVisibleRange: () => {}, cachedAt: null, refreshing: false, refreshFailed: false, loadingRange: false,
  }}>{children}</CalendarStoreAdapter>;
}