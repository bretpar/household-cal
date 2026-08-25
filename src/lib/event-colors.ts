import {
  UNCATEGORIZED_APPEARANCE,
  type CategoryAppearance,
} from "@/lib/event-categories";

/**
 * Single source of truth for how an event card is coloured.
 *
 * Two independent visual systems:
 * - the *category* answers "what is this event" and owns the card tint/accent
 * - the *family member* answers "who is involved" and owns the initial badges
 *
 * Member colours are therefore never blended into the card background: an event
 * with two people shows two badges on the category-coloured card.
 *
 * `category_id = null` (including every Google import until somebody assigns a
 * category) renders with the neutral Uncategorized appearance — a neutral card
 * is a normal state, never an error.
 */
export const UNCATEGORIZED_TINT = UNCATEGORIZED_APPEARANCE.soft;
export const UNCATEGORIZED_ACCENT = UNCATEGORIZED_APPEARANCE.swatch;

/** Soft tint used as the card/pill background. */
export function eventTintClass(appearance: CategoryAppearance | null | undefined): string {
  return appearance?.soft ?? UNCATEGORIZED_TINT;
}

/** Solid accent used for the left edge stripe / colour indicator. */
export function eventAccentClass(appearance: CategoryAppearance | null | undefined): string {
  return appearance?.swatch ?? UNCATEGORIZED_ACCENT;
}

/**
 * True when every family member is on the event and there are enough of them that
 * showing each badge would overcrowd the card — render a compact "All" chip instead.
 */
export function isEveryoneAssigned(
  memberIds: readonly string[],
  totalMembers: number,
): boolean {
  const unique = new Set(memberIds);
  return totalMembers >= 4 && unique.size >= totalMembers;
}
