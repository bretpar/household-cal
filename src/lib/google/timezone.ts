/**
 * Timezone reconciliation between the household and its Google calendars.
 *
 * Pure helpers: no Google or database access, so the decision table can be
 * tested directly. The household's IANA zone (`families.timezone`) is always the
 * source of truth for timed sync; a Google calendar's display timezone must
 * never influence the wall-clock times we push.
 */

export const FALLBACK_TIME_ZONE = "America/Los_Angeles";

/**
 * True only for real IANA zone ids ("America/Los_Angeles", "UTC").
 * Fixed offsets ("GMT-8", "Etc/GMT+8", "-08:00") are rejected because they
 * cannot express daylight saving and would silently drift recurring events.
 */
export function isIanaTimeZone(value: string | null | undefined): boolean {
  const tz = (value ?? "").trim();
  if (!tz) return false;
  if (/^(gmt|utc)?[+-]\d/i.test(tz)) return false;
  if (/^etc\//i.test(tz) && /gmt|utc/i.test(tz)) return false;
  if (tz !== "UTC" && !tz.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Normalises any stored value to a usable IANA zone. */
export function normalizeTimeZone(value: string | null | undefined): string {
  return isIanaTimeZone(value) ? (value as string).trim() : FALLBACK_TIME_ZONE;
}

export type TimeZoneAction =
  /** Google already matches the household, or we have no reading yet. */
  | { kind: "ok" }
  /** Safe to fix silently: the app created and manages this calendar. */
  | { kind: "update"; timeZone: string }
  /** Someone else's calendar: never rewrite it, surface a Settings warning. */
  | { kind: "warn"; googleTimeZone: string; householdTimeZone: string };

/**
 * Decides what to do about a Google calendar whose display timezone differs from
 * the household zone.
 */
export function timeZoneAction(input: {
  householdTimeZone: string;
  googleTimeZone: string | null | undefined;
  appManaged: boolean;
}): TimeZoneAction {
  const household = normalizeTimeZone(input.householdTimeZone);
  const google = (input.googleTimeZone ?? "").trim();
  if (!google || google === household) return { kind: "ok" };
  if (input.appManaged) return { kind: "update", timeZone: household };
  return { kind: "warn", googleTimeZone: google, householdTimeZone: household };
}
