/**
 * Canonical rule for "can this calendar be picked for an email summary?".
 *
 * Used by the recipient editor, the save path, preview rendering and the
 * scheduled dispatch, so UI, server and cron can never disagree. Deliberately
 * provider-agnostic: a local or future non-Google calendar qualifies as soon as
 * it is marked `selectable_in_email`.
 */

export interface EmailSelectableSource {
  active?: boolean | null;
  display_mode?: string | null;
  selectable_in_email?: boolean | null;
}

export function isEmailSelectableCalendar(source: EmailSelectableSource | null | undefined): boolean {
  if (!source) return false;
  if (source.active !== true) return false;
  if (source.display_mode === "coverage_background") return false;
  return source.selectable_in_email === true;
}

export function emailSelectableCalendars<T extends EmailSelectableSource>(sources: T[]): T[] {
  return sources.filter(isEmailSelectableCalendar);
}
