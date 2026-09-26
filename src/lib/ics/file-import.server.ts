/**
 * One-time import of an uploaded .ics file into an OFC calendar.
 *
 * Unlike Apple subscriptions, imported events become ordinary editable app
 * events and no link to the file is kept. Duplicate protection uses a content
 * fingerprint (title + times + repeat rule) against the destination calendar,
 * because `external_event_id` is owned by Google sync for linked calendars.
 */
import { parseIcs, type IcsEvent } from "@/lib/ics/parse";

type Db = { from: (table: string) => any };

export const MAX_FILE_CHARS = 2_000_000;
export const MAX_EVENTS = 3000;
export const BATCH_SIZE = 100;

export interface ImportDestination {
  id: string;
  name: string;
  googleBound: boolean;
}

export function assertIcsText(text: unknown): string {
  if (typeof text !== "string" || !text.trim()) throw new Error("Choose a calendar file (.ics)");
  if (text.length > MAX_FILE_CHARS) throw new Error("That file is too large (2 MB maximum)");
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That file is not a calendar (.ics) file");
  return text;
}

/** Fields the app can't represent — disclosed in the preview, never claimed as imported. */
export function unsupportedFields(text: string): string[] {
  const checks: [RegExp, string][] = [
    [/^BEGIN:VALARM/im, "Reminders / alerts"],
    [/^ATTENDEE/im, "Attendees and RSVPs"],
    [/^ORGANIZER/im, "Organizer"],
    [/^ATTACH/im, "Attachments"],
    [/^RDATE/im, "Extra one-off repeat dates (RDATE)"],
    [/^(CATEGORIES|COLOR)/im, "Source categories and colors"],
    [/^URL/im, "Event links (URL field)"],
    [/^BEGIN:(VTODO|VJOURNAL)/im, "Tasks and journal entries"],
    [/RRULE:[^\n]*(BYSETPOS|BYWEEKNO|BYYEARDAY|BYHOUR|BYMINUTE)/im, "Some advanced repeat rules (simplified)"],
  ];
  return checks.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function exceptionDay(recurrenceId: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(recurrenceId.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface PreparedRow {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates: string[];
}

/** Parses and orders importable rows; changed occurrences are removed from their series. */
export function prepareRows(text: string, zone: string): { rows: PreparedRow[]; cancelled: number } {
  const events = parseIcs(text, zone);
  const exceptionsByUid = new Map<string, string[]>();
  for (const e of events) {
    if (!e.recurrenceId) continue;
    const day = exceptionDay(e.recurrenceId);
    if (day) exceptionsByUid.set(e.uid, [...(exceptionsByUid.get(e.uid) ?? []), day]);
  }
  let cancelled = 0;
  const rows: PreparedRow[] = [];
  const ordered = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  for (const e of ordered as IcsEvent[]) {
    if (e.cancelled) {
      cancelled += 1;
      continue;
    }
    const extra = !e.recurrenceId && e.recurrenceRule ? exceptionsByUid.get(e.uid) ?? [] : [];
    rows.push({
      title: e.title.slice(0, 200),
      start_at: e.startAt,
      end_at: e.endAt,
      all_day: e.allDay,
      location: e.location,
      notes: e.description,
      recurrence_rule: e.recurrenceRule,
      recurrence_until: e.recurrenceUntil,
      excluded_dates: Array.from(new Set([...e.excludedDates, ...extra])).sort(),
    });
  }
  return { rows, cancelled };
}

export function fingerprint(r: {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence_rule: string | null;
}): string {
  return [
    r.title.trim().toLowerCase(),
    new Date(r.start_at).toISOString(),
    new Date(r.end_at).toISOString(),
    r.all_day ? "1" : "0",
    r.recurrence_rule ?? "",
  ].join("|");
}

export async function existingFingerprints(admin: Db, familyId: string, sourceId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await admin
      .from("events")
      .select("title, start_at, end_at, all_day, recurrence_rule")
      .eq("family_id", familyId)
      .eq("calendar_source_id", sourceId)
      .range(from, from + page - 1);
    if (error) throw error;
    for (const row of data ?? []) set.add(fingerprint(row));
    if (!data || data.length < page) break;
  }
  return set;
}

/** Owner's writable OFC destination: Family or an active user-created calendar (local or linked). */
export async function resolveImportDestination(
  admin: Db,
  familyId: string,
  sourceId: string,
): Promise<ImportDestination> {
  const { data, error } = await admin
    .from("calendar_sources")
    .select("id, name, provider, calendar_kind, active, family_id")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw error;
  const ok =
    data &&
    data.active &&
    ((data.calendar_kind === "custom" && (data.provider === "local" || data.provider === "google")) ||
      (data.calendar_kind === "household_default" && data.provider === "local"));
  if (!ok) throw new Error("Calendar files can only be imported into an active Our Family Calendar calendar");

  let googleBound = data.provider === "google";
  if (data.calendar_kind === "household_default") {
    const { data: main } = await admin
      .from("calendar_sources")
      .select("id")
      .eq("family_id", familyId)
      .eq("provider", "google")
      .eq("is_main", true)
      .eq("active", true)
      .limit(1);
    googleBound = (main ?? []).length > 0;
  }
  return { id: data.id, name: data.name, googleBound };
}

export async function householdZone(admin: Db, familyId: string): Promise<string> {
  const { data } = await admin.from("families").select("timezone").eq("id", familyId).maybeSingle();
  return (data?.timezone as string | undefined) || "UTC";
}
