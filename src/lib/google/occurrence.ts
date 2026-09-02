/**
 * Pure helpers for deciding whether a local series already renders a given day.
 *
 * Used by the Google inbound paths to tell a *confirmed* Google instance that is
 * already covered by the linked local series (nothing to do) apart from one that
 * the local series does not render at all (must be materialised as an occurrence
 * exception). No Supabase, no Google, no side effects — safe to unit test.
 */

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** yyyy-MM-dd for an instant, evaluated in the household timezone. */
export function localDateKey(iso: string, timeZone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function utcOf(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function weekdayCode(dateKey: string): string {
  return DAY_CODES[new Date(utcOf(dateKey)).getUTCDay()]!;
}

function mondayOf(dateKey: string): number {
  const ms = utcOf(dateKey);
  const day = new Date(ms).getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7;
  return ms - back * 86_400_000;
}

export interface LocalSeries {
  /** Series start instant (events.start_at). */
  startAt: string;
  recurrenceRule: string | null;
  recurrenceUntil: string | null;
  excludedDates: string[] | null;
  timeZone: string;
}

/**
 * True when the local series (as stored) renders an occurrence on `dateKey`.
 * Conservative by design: an unsupported/unknown rule returns false so the
 * caller materialises the authoritative Google instance instead of dropping it.
 */
export function seriesCoversDate(series: LocalSeries, dateKey: string): boolean {
  const startKey = localDateKey(series.startAt, series.timeZone);
  if (!startKey) return false;
  if ((series.excludedDates ?? []).includes(dateKey)) return false;
  if (series.recurrenceUntil && dateKey > series.recurrenceUntil) return false;

  const rule = series.recurrenceRule;
  if (!rule || rule === "CUSTOM") return dateKey === startKey;
  if (dateKey < startKey) return false;

  const parts = Object.fromEntries(
    rule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k ?? "", v ?? ""];
    }),
  ) as Record<string, string>;
  const freq = parts["FREQ"] ?? "WEEKLY";
  const interval = Number(parts["INTERVAL"] ?? 1) || 1;
  const until = parts["UNTIL"] ? parts["UNTIL"].slice(0, 8) : null;
  if (until) {
    const untilKey = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    if (dateKey > untilKey) return false;
  }

  const days = Math.round((utcOf(dateKey) - utcOf(startKey)) / 86_400_000);

  if (freq === "DAILY") return days % interval === 0;
  if (freq === "WEEKLY") {
    const byDay = parts["BYDAY"] ? parts["BYDAY"].split(",") : [weekdayCode(startKey)];
    if (!byDay.includes(weekdayCode(dateKey))) return false;
    const weeks = Math.round((mondayOf(dateKey) - mondayOf(startKey)) / (7 * 86_400_000));
    return weeks % interval === 0;
  }
  if (freq === "MONTHLY") {
    const d = (k: string) => k.slice(8, 10);
    if (d(dateKey) !== d(startKey)) return false;
    const months =
      (Number(dateKey.slice(0, 4)) - Number(startKey.slice(0, 4))) * 12 +
      (Number(dateKey.slice(5, 7)) - Number(startKey.slice(5, 7)));
    return months % interval === 0;
  }
  return false;
}
