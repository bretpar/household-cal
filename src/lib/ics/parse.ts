/**
 * Minimal iCalendar (RFC 5545) reader for read-only Apple/iCloud subscriptions.
 *
 * Deliberately small and dependency-free: it understands only what the app can
 * actually render (single timed events, all-day events, simple repeats and
 * changed/removed occurrences) and ignores everything else. Nothing here touches
 * the database or Google sync.
 */

export interface IcsEvent {
  /** stable identifier from the feed */
  uid: string;
  /** set when this VEVENT overrides one occurrence of `uid` */
  recurrenceId: string | null;
  title: string;
  location: string | null;
  description: string | null;
  allDay: boolean;
  /** ISO instant (all-day: midnight of the day) */
  startAt: string;
  endAt: string;
  /** simplified RRULE string, or null for a one-off */
  recurrenceRule: string | null;
  /** yyyy-MM-dd mirror of RRULE UNTIL */
  recurrenceUntil: string | null;
  /** yyyy-MM-dd dates removed from the series */
  excludedDates: string[];
  cancelled: boolean;
}

interface RawLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Unfolds RFC 5545 continuation lines and splits name;params:value. */
function parseLines(text: string): RawLine[] {
  const unfolded: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      unfolded[unfolded.length - 1] = (unfolded[unfolded.length - 1] ?? "") + raw.slice(1);
    } else if (raw.length > 0) {
      unfolded.push(raw);
    }
  }

  return unfolded.map((line) => {
    const colon = line.indexOf(":");
    const head = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1);
    const [name, ...paramParts] = head.split(";");
    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { name: (name ?? "").toUpperCase(), params, value };
  });
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/** Offset (ms) of an IANA zone from UTC at a given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - instant;
}

/** Wall-clock time in a zone → UTC instant, DST-aware. */
export function zonedWallClockToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let offset = zoneOffsetMs(naive, timeZone);
  let instant = naive - offset;
  const corrected = zoneOffsetMs(instant, timeZone);
  if (corrected !== offset) {
    offset = corrected;
    instant = naive - offset;
  }
  return new Date(instant);
}

function isValidTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export interface IcsMoment {
  date: Date;
  allDay: boolean;
}

/**
 * Parses DATE / DATE-TIME values in all three forms the feeds use:
 * `20260918`, `20260918T083000Z` and `TZID=America/Los_Angeles:20260918T083000`.
 * A floating time (no zone, no Z) is read in `fallbackZone`.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {},
  fallbackZone = "UTC",
): IcsMoment | null {
  const clean = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { date: new Date(`${y}-${m}-${d}T00:00:00.000Z`), allDay: true };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(clean);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  if (z === "Z") {
    return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), allDay: false };
  }
  const tzid = params["TZID"];
  const zone = isValidTimeZone(tzid) ? tzid : fallbackZone;
  return { date: zonedWallClockToUtc(parts, zone), allDay: false };
}

/** ISO 8601 duration (`P1DT2H`) in milliseconds; only what feeds emit. */
export function parseIcsDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    Number(w ?? 0) * 604800000 +
    Number(d ?? 0) * 86400000 +
    Number(h ?? 0) * 3600000 +
    Number(mi ?? 0) * 60000 +
    Number(s ?? 0) * 1000;
  return sign === "-" ? -ms : ms;
}

function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Keeps only the RRULE parts the app's own recurrence engine understands. */
function simplifyRrule(rule: string): { rule: string | null; until: string | null } {
  const parts = rule
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const keep: string[] = [];
  let until: string | null = null;
  for (const part of parts) {
    const [rawKey, rawValue = ""] = part.split("=");
    const key = (rawKey ?? "").toUpperCase();
    if (key === "UNTIL") {
      const moment = parseIcsDate(rawValue, {}, "UTC");
      if (moment) until = dayKeyUtc(moment.date);
      keep.push(`UNTIL=${rawValue}`);
      continue;
    }
    if (["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "WKST"].includes(key)) {
      keep.push(`${key}=${rawValue.toUpperCase()}`);
    }
  }
  const freq = keep.find((p) => p.startsWith("FREQ="));
  if (!freq) return { rule: null, until: null };
  return { rule: keep.join(";"), until };
}

/**
 * Reads every usable VEVENT out of an ICS document. `fallbackZone` is the
 * household timezone, used only for floating times.
 */
export function parseIcs(text: string, fallbackZone = "UTC"): IcsEvent[] {
  const lines = parseLines(text);
  const events: IcsEvent[] = [];

  let current: Partial<IcsEvent> & { _start?: IcsMoment; _end?: IcsMoment; _duration?: number } | null = null;
  let depth = 0;

  for (const line of lines) {
    if (line.name === "BEGIN" && line.value.toUpperCase() === "VEVENT") {
      current = { excludedDates: [], cancelled: false };
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Skip nested components (VALARM and friends).
    if (line.name === "BEGIN") {
      depth += 1;
      continue;
    }
    if (line.name === "END" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;

    if (line.name === "END" && line.value.toUpperCase() === "VEVENT") {
      const start = current._start;
      if (current.uid && start) {
        const allDay = start.allDay;
        let end = current._end?.date ?? null;
        if (!end && current._duration !== undefined) {
          end = new Date(start.date.getTime() + current._duration);
        }
        if (!end) {
          end = new Date(start.date.getTime() + (allDay ? 86400000 : 3600000));
        }
        // ICS all-day DTEND is exclusive; the app stores an inclusive last day.
        if (allDay && end.getTime() > start.date.getTime()) {
          end = new Date(end.getTime() - 86400000);
        }
        if (end.getTime() < start.date.getTime()) end = start.date;

        events.push({
          uid: current.uid,
          recurrenceId: current.recurrenceId ?? null,
          title: current.title?.trim() || "Busy",
          location: current.location ?? null,
          description: current.description ?? null,
          allDay,
          startAt: start.date.toISOString(),
          endAt: end.toISOString(),
          recurrenceRule: current.recurrenceRule ?? null,
          recurrenceUntil: current.recurrenceUntil ?? null,
          excludedDates: Array.from(new Set(current.excludedDates ?? [])).sort(),
          cancelled: current.cancelled ?? false,
        });
      }
      current = null;
      continue;
    }

    switch (line.name) {
      case "UID":
        current.uid = line.value.trim();
        break;
      case "SUMMARY":
        current.title = unescapeText(line.value);
        break;
      case "LOCATION": {
        const location = unescapeText(line.value);
        current.location = location || null;
        break;
      }
      case "DESCRIPTION": {
        const description = unescapeText(line.value);
        current.description = description || null;
        break;
      }
      case "DTSTART": {
        const moment = parseIcsDate(line.value, line.params, fallbackZone);
        if (moment) current._start = moment;
        break;
      }
      case "DTEND": {
        const moment = parseIcsDate(line.value, line.params, fallbackZone);
        if (moment) current._end = moment;
        break;
      }
      case "DURATION": {
        const ms = parseIcsDuration(line.value);
        if (ms !== null) current._duration = ms;
        break;
      }
      case "RRULE": {
        const { rule, until } = simplifyRrule(line.value);
        current.recurrenceRule = rule;
        current.recurrenceUntil = until;
        break;
      }
      case "EXDATE": {
        for (const piece of line.value.split(",")) {
          const moment = parseIcsDate(piece, line.params, fallbackZone);
          if (moment) (current.excludedDates ??= []).push(dayKeyUtc(moment.date));
        }
        break;
      }
      case "RECURRENCE-ID": {
        current.recurrenceId = line.value.trim();
        break;
      }
      case "STATUS": {
        if (line.value.trim().toUpperCase() === "CANCELLED") current.cancelled = true;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

/**
 * Stable per-event key used as `events.external_event_id`, so a refresh updates
 * the same row instead of importing a duplicate.
 */
export function icsExternalId(event: Pick<IcsEvent, "uid" | "recurrenceId">): string {
  return event.recurrenceId ? `${event.uid}::${event.recurrenceId}` : event.uid;
}

export interface IcsWindow {
  /** ISO instant — events ending before this are ignored */
  from: string;
  /** ISO instant — events starting after this are ignored */
  to: string;
}

/** Repeating series are always kept; one-offs must touch the window. */
export function withinWindow(event: IcsEvent, window: IcsWindow): boolean {
  if (event.recurrenceRule) {
    if (!event.recurrenceUntil) return true;
    return `${event.recurrenceUntil}T23:59:59.999Z` >= window.from;
  }
  return event.endAt >= window.from && event.startAt <= window.to;
}
