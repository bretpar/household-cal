/**
 * Household-configurable event categories.
 *
 * A category answers "what is this event" and is coloured independently of the
 * family-member colours, which answer "who is involved".
 *
 * "Uncategorized" is a system-level state, not a row: an event whose
 * `category_id` is null renders with the neutral appearance below. It therefore
 * never counts toward the 7 custom categories and can never be deleted. Google
 * imports always land here until somebody assigns a category by hand — we never
 * guess a category from Google's own colour.
 */

import { MEMBER_COLORS, styleForColor, type EventType, type MemberColor } from "@/lib/family-data";

export const MAX_CUSTOM_CATEGORIES = 7;

export const UNCATEGORIZED_LABEL = "Uncategorized";

/** Neutral, distinct from every member/category palette entry. */
export const UNCATEGORIZED_APPEARANCE = {
  label: UNCATEGORIZED_LABEL,
  swatch: "bg-border",
  soft: "bg-surface-muted",
} as const;

export interface EventCategory {
  id: string;
  family_id: string;
  name: string;
  color: MemberColor;
  sort_order: number;
}

/** Curated palette — households pick a swatch, never a raw hex value. */
export const CATEGORY_COLORS = MEMBER_COLORS;

/** Starter set for a brand-new household; fully renamable/removable. */
export const DEFAULT_CATEGORIES: { name: string; color: MemberColor }[] = [
  { name: "School", color: "sky" },
  { name: "Activity", color: "sage" },
  { name: "Work", color: "teal" },
  { name: "Appointment", color: "rose" },
  { name: "Family", color: "amber" },
];

export interface CategoryAppearance {
  label: string;
  /** solid swatch / accent class */
  swatch: string;
  /** soft tint class */
  soft: string;
}

export function resolveCategory(
  categories: EventCategory[],
  categoryId: string | null | undefined,
): EventCategory | null {
  if (!categoryId) return null;
  return categories.find((c) => c.id === categoryId) ?? null;
}

/** Anything with a category-ish shape: a stored id and/or the legacy event_type. */
export type CategorizableEvent = {
  category_id?: string | null;
  event_type?: EventType | null;
};

/** Accepts a bare category id or a whole event row. */
export type CategoryRef = string | null | undefined | CategorizableEvent;

function refToEvent(ref: CategoryRef): CategorizableEvent {
  if (ref === null || ref === undefined) return { category_id: null };
  if (typeof ref === "string") return { category_id: ref };
  return ref;
}

/**
 * Legacy/stale bridge: events created before household categories existed (and
 * everything imported from Google) only carry `event_type`. Match them to the
 * household category whose name maps to the same behaviour, so older rows show
 * the household's current name/colour instead of Uncategorized.
 */
export function categoryForEventType(
  categories: EventCategory[],
  eventType: EventType | null | undefined,
): EventCategory | null {
  if (!eventType || eventType === "other") return null;
  return categories.find((c) => eventTypeForCategoryName(c.name) === eventType) ?? null;
}

/**
 * Single source of truth for "which household category is this event in".
 * Order: the stored category row → the legacy event_type match → Uncategorized
 * (which also covers ids pointing at a category that was deleted or renamed
 * away in Settings).
 */
export function resolveEventCategory(
  categories: EventCategory[],
  ref: CategoryRef,
): EventCategory | null {
  const event = refToEvent(ref);
  return (
    resolveCategory(categories, event.category_id) ??
    categoryForEventType(categories, event.event_type)
  );
}

/** Effective category id for form defaults/filters; null = Uncategorized. */
export function resolvedCategoryId(
  categories: EventCategory[],
  ref: CategoryRef,
): string | null {
  return resolveEventCategory(categories, ref)?.id ?? null;
}

/** Anything unmapped — including Google imports — resolves to Uncategorized. */
export function categoryAppearance(category: EventCategory | null): CategoryAppearance {
  if (!category) return { ...UNCATEGORIZED_APPEARANCE };
  const style = styleForColor(category.color);
  return { label: category.name, swatch: style.dot, soft: style.soft };
}

export function appearanceForEvent(
  categories: EventCategory[],
  ref: CategoryRef,
): CategoryAppearance {
  return categoryAppearance(resolveEventCategory(categories, ref));
}


export function canAddCategory(categories: EventCategory[]): boolean {
  return categories.length < MAX_CUSTOM_CATEGORIES;
}

export function nextSortOrder(categories: EventCategory[]): number {
  return categories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
}

export function assertCategoryColor(color: unknown): MemberColor {
  if (typeof color === "string" && (CATEGORY_COLORS as string[]).includes(color)) {
    return color as MemberColor;
  }
  throw new Error("Choose a category color from the palette");
}

/** Trimmed name, unique within the household (case-insensitive). */
export function assertCategoryName(
  name: unknown,
  existing: Pick<EventCategory, "id" | "name">[],
  excludeId?: string,
): string {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) throw new Error("Give the category a name");
  if (clean.length > 40) throw new Error("Category names must be 40 characters or fewer");
  if (clean.toLowerCase() === UNCATEGORIZED_LABEL.toLowerCase()) {
    throw new Error(`"${UNCATEGORIZED_LABEL}" is reserved`);
  }
  const clash = existing.some(
    (c) => c.id !== excludeId && c.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  if (clash) throw new Error("That category name is already used");
  return clean;
}

/** Sentinel used by the category filter to mean "events with no category". */
export const UNCATEGORIZED_FILTER = "uncategorized";

/** `null` selection means no filter. Coverage layers are always kept visible. */
export type CategorySelection = string | null;

export function eventMatchesCategory(
  event: { category_id?: string | null },
  selected: CategorySelection,
): boolean {
  if (!selected) return true;
  if (selected === UNCATEGORIZED_FILTER) return !event.category_id;
  return event.category_id === selected;
}

/** Select value standing in for the system Uncategorized state (no row). */
export const UNCATEGORIZED_VALUE = "uncategorized";

/**
 * Household categories are the single source of truth for what an event is.
 * `event_type` remains stored for behavioural rules (childcare renders as a
 * coverage layer) and Google mapping, so we derive it from the chosen
 * category's name instead of asking the user twice.
 */
export function eventTypeForCategoryName(name: string | null | undefined): EventType {
  const clean = (name ?? "").trim().toLowerCase();
  if (!clean) return "other";
  if (/(babysit|childcare|nanny|sitter|caregiv|coverage)/.test(clean)) return "childcare";
  if (clean.startsWith("school")) return "school";
  if (clean.startsWith("activit")) return "activity";
  if (clean.startsWith("appointment")) return "appointment";
  if (clean.startsWith("work")) return "work";
  if (clean.startsWith("famil")) return "family";
  if (clean.startsWith("travel") || clean.startsWith("trip") || clean.startsWith("vacation")) {
    return "travel";
  }
  if (clean.startsWith("birthday")) return "birthday";
  return "other";
}
