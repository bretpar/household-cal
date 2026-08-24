import type { MemberStyle } from "@/lib/family-data";

/**
 * Single source of truth for how an event card is coloured.
 *
 * - exactly one member  → that member's soft pastel + their badge
 * - two or more members → one shared neutral, so no single member "owns" the card
 * - no members          → the existing unassigned neutral
 *
 * Ordering of member ids never affects the result.
 */
export const SHARED_TINT = "bg-shared";
export const SHARED_ACCENT = "bg-shared-strong";
export const UNASSIGNED_TINT = "bg-surface-muted";
export const UNASSIGNED_ACCENT = "bg-border";

function soleMember(memberIds: readonly string[]): string | null {
  const unique = Array.from(new Set(memberIds));
  return unique.length === 1 ? unique[0]! : null;
}

export function eventTintClass(
  memberIds: readonly string[],
  styleFor: (id: string) => MemberStyle,
): string {
  const unique = Array.from(new Set(memberIds));
  if (unique.length === 0) return UNASSIGNED_TINT;
  const only = soleMember(unique);
  return only ? styleFor(only).soft : SHARED_TINT;
}

export function eventAccentClass(
  memberIds: readonly string[],
  styleFor: (id: string) => MemberStyle,
): string {
  const unique = Array.from(new Set(memberIds));
  if (unique.length === 0) return UNASSIGNED_ACCENT;
  const only = soleMember(unique);
  return only ? styleFor(only).dot : SHARED_ACCENT;
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
