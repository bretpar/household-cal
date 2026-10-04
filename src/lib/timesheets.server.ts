/**
 * Timesheet v1 server logic. All writes use the admin client AFTER the caller's
 * identity/role is verified from the session; RLS only grants reads.
 * Caregiver identity is family_members.id (assignee_member_id), never family_user_id.
 */
import { assertFeature } from "@/lib/features";
import { localDateKey, seriesCoversDate } from "@/lib/google/occurrence";
import {
  DEFAULT_PAY_SETTINGS,
  eachDateKey,
  payPeriodFor,
  type PayPeriod,
  type PaySettings,
} from "@/lib/timesheet-periods";

type AnyDb = { from: (t: string) => any; rpc: (f: string, a: unknown) => any };

export async function adminDb(): Promise<AnyDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AnyDb;
}

export async function currentFamilyId(db: AnyDb, userId: string): Promise<string> {
  const { data, error } = await db
    .from("family_users")
    .select("family_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const id = data?.[0]?.family_id as string | undefined;
  if (!id) throw new Error("No household found");
  return id;
}

export async function assertOwner(userDb: AnyDb, familyId: string) {
  assertFeature("timesheets", { familyId });
  const { data, error } = await userDb.rpc("is_family_owner", { _family_id: familyId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only the household owner can do this");
}

/** The signed-in caregiver's own member id (via verified session), or an error. */
export async function myCaregiver(userDb: AnyDb, userId: string) {
  const familyId = await currentFamilyId(userDb, userId);
  assertFeature("timesheets", { familyId });
  const { data, error } = await userDb.rpc("my_caregiver_member_id", { _family_id: familyId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Timesheets are only available to caregivers");
  const m = await (await adminDb()).from("family_members").select("timesheets_enabled").eq("id", data).maybeSingle();
  if (m.data?.timesheets_enabled !== true) throw new Error("Timesheets are turned off for you in this household");
  return { familyId, memberId: data as string };
}

/**
 * Owner-managed time cards: an active, Timesheet-enabled caregiver with NO
 * household sign-in. Caregivers who can sign in use the normal submit flow.
 */
export async function ownerManagedCaregiver(admin: AnyDb, familyId: string, memberId: string) {
  const m = await admin
    .from("family_members")
    .select("id, name, role, active, removed_at, timesheets_enabled")
    .eq("id", memberId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (m.error) throw new Error(m.error.message);
  if (!m.data || m.data.role !== "caregiver" || !m.data.timesheets_enabled) throw new Error("Caregiver not found");
  const fu = await admin.from("family_users").select("id").eq("family_id", familyId).eq("family_member_id", memberId).limit(1);
  if (fu.error) throw new Error(fu.error.message);
  if ((fu.data ?? []).length) throw new Error("This caregiver signs in and submits her own timesheet");
  return m.data as { id: string; name: string; active: boolean; removed_at: string | null };
}

export async function loadPaySettings(db: AnyDb, familyId: string) {
  const [s, f] = await Promise.all([
    db.from("timesheet_settings").select("frequency, anchor_date, semimonthly_first_end").eq("family_id", familyId).maybeSingle(),
    db.from("families").select("timezone").eq("id", familyId).single(),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (f.error) throw new Error(f.error.message);
  return {
    settings: (s.data as PaySettings | null) ?? DEFAULT_PAY_SETTINGS,
    timeZone: (f.data?.timezone as string) || "America/Los_Angeles",
  };
}

/* ----------------------------------------------------------- time zone math */

function parts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), min: g("minute"), s: g("second") };
}

/** Household-local date + "HH:mm" -> UTC instant. */
export function zonedInstant(dateKey: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let at = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(at), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    at = guess - (asUtc - at);
  }
  return new Date(at);
}

export function localHHmm(iso: string, tz: string): string {
  const p = parts(new Date(iso), tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export function todayKey(tz: string) {
  return localDateKey(new Date().toISOString(), tz) ?? new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------- scheduled shifts */

export interface ScheduledShift {
  event_id: string;
  occurrence_key: string;
  work_date: string;
  title: string;
  start: string;
  end: string;
}

/** Babysitter-calendar shifts explicitly assigned to this caregiver in the period. */
export async function scheduledShifts(
  admin: AnyDb,
  familyId: string,
  memberId: string,
  period: PayPeriod,
  tz: string,
): Promise<ScheduledShift[]> {
  const linked = await admin.from("family_users").select("id").eq("family_member_id", memberId);
  if (linked.error) throw new Error(linked.error.message);
  const linkedIds = new Set((linked.data ?? []).map((r: any) => r.id as string));
  const { data, error } = await admin
    .from("babysitter_shifts")
    .select("event_id, assignee_member_id, family_user_id, events!inner(id, title, start_at, end_at, all_day, recurrence_rule, recurrence_until, excluded_dates)")
    .eq("family_id", familyId)
    .eq("assignment", "caregiver");
  if (error) throw new Error(error.message);
  const out: ScheduledShift[] = [];
  const keys = eachDateKey(period);
  for (const row of data ?? []) {
    const mine =
      row.assignee_member_id === memberId ||
      (!row.assignee_member_id && row.family_user_id && linkedIds.has(row.family_user_id));
    const e = row.events;
    if (!mine || !e || e.all_day) continue;
    const duration = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
    if (!e.recurrence_rule) {
      const key = localDateKey(e.start_at, tz);
      if (key && key >= period.start && key <= period.end) {
        out.push({ event_id: e.id, occurrence_key: `${e.id}:${key}`, work_date: key, title: e.title, start: e.start_at, end: e.end_at });
      }
      continue;
    }
    const hhmm = localHHmm(e.start_at, tz);
    for (const key of keys) {
      const covers = seriesCoversDate(
        { startAt: e.start_at, recurrenceRule: e.recurrence_rule, recurrenceUntil: e.recurrence_until, excludedDates: e.excluded_dates, timeZone: tz },
        key,
      );
      if (!covers) continue;
      const start = zonedInstant(key, hhmm, tz);
      out.push({
        event_id: e.id, occurrence_key: `${e.id}:${key}`, work_date: key, title: e.title,
        start: start.toISOString(), end: new Date(start.getTime() + duration).toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Find/create the timesheet; while editable, refresh scheduled entries from shifts. */
export async function ensureTimesheet(
  admin: AnyDb,
  familyId: string,
  memberId: string,
  offset: number,
) {
  const { settings, timeZone } = await loadPaySettings(admin, familyId);
  const period = payPeriodFor(settings, todayKey(timeZone), offset);
  const member = await admin.from("family_members").select("name, timesheet_start_date").eq("id", memberId).single();
  if (member.error) throw new Error(member.error.message);
  const startDate = (member.data.timesheet_start_date as string | null) ?? null;

  let sheet = (
    await admin.from("timesheets").select("*").eq("family_member_id", memberId).eq("period_start", period.start).maybeSingle()
  ).data as any;
  if (!sheet) {
    const ins = await admin
      .from("timesheets")
      .insert({ family_id: familyId, family_member_id: memberId, caregiver_name: member.data.name, period_start: period.start, period_end: period.end })
      .select("*")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    sheet = ins.data;
  }

  if (sheet.status === "draft" || sheet.status === "needs_correction") {
    // Shifts before the caregiver's Timesheet start date are never added.
    const shifts = (await scheduledShifts(admin, familyId, memberId, { start: sheet.period_start, end: sheet.period_end }, timeZone))
      .filter((sh) => !startDate || sh.work_date >= startDate);
    const existing = await admin.from("timesheet_entries").select("id, occurrence_key, is_manual, actual_time_confirmed").eq("timesheet_id", sheet.id);
    if (existing.error) throw new Error(existing.error.message);
    const byKey = new Map<string, any>((existing.data ?? []).filter((r: any) => r.occurrence_key).map((r: any) => [r.occurrence_key, r]));
    const live = new Set(shifts.map((s) => s.occurrence_key));
    for (const s of shifts) {
      const hit = byKey.get(s.occurrence_key);
      if (hit) {
        // Scheduled always refreshes; Actual follows only while it is still the unconfirmed default.
        const patch: Record<string, unknown> = { scheduled_title: s.title, scheduled_start: s.start, scheduled_end: s.end };
        if (!hit.actual_time_confirmed) { patch["actual_start"] = s.start; patch["actual_end"] = s.end; }
        await admin.from("timesheet_entries").update(patch).eq("id", hit.id);
      } else {
        const r = await admin.from("timesheet_entries").insert({
          timesheet_id: sheet.id, family_id: familyId, event_id: s.event_id, occurrence_key: s.occurrence_key,
          work_date: s.work_date, scheduled_title: s.title, scheduled_start: s.start, scheduled_end: s.end,
          actual_start: s.start, actual_end: s.end,
        });
        if (r.error) throw new Error(r.error.message);
      }
    }
    const stale = (existing.data ?? []).filter((r: any) => !r.is_manual && r.occurrence_key && !live.has(r.occurrence_key)).map((r: any) => r.id);
    if (stale.length) await admin.from("timesheet_entries").delete().in("id", stale);
  }
  return { sheet, timeZone, settings, startDate };
}

/** Caregiver's Timesheet start date (NULL = no limit). */
export async function timesheetStartDate(admin: AnyDb, memberId: string): Promise<string | null> {
  const { data } = await admin.from("family_members").select("timesheet_start_date").eq("id", memberId).maybeSingle();
  return (data?.timesheet_start_date as string | null) ?? null;
}

/** Caregiver-confirmed Actual differs from the scheduled shift (manual entries have no schedule). */
export function isCaregiverAdjusted(e: { is_manual: boolean; actual_time_confirmed?: boolean; scheduled_start: string | null; scheduled_end: string | null; actual_start: string; actual_end: string }) {
  if (e.is_manual || !e.actual_time_confirmed || !e.scheduled_start || !e.scheduled_end) return false;
  const t = (x: string) => Math.floor(new Date(x).getTime() / 60000);
  return t(e.actual_start) !== t(e.scheduled_start) || t(e.actual_end) !== t(e.scheduled_end);
}

export async function loadEntries(admin: AnyDb, timesheetId: string, tz: string) {
  const { data, error } = await admin
    .from("timesheet_entries")
    .select("id, event_id, work_date, scheduled_title, scheduled_start, scheduled_end, actual_start, actual_end, is_manual, note, owner_edited_at, actual_time_confirmed")
    .eq("timesheet_id", timesheetId)
    .order("actual_start", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({
    ...e,
    actual_start_local: localHHmm(e.actual_start, tz),
    actual_end_local: localHHmm(e.actual_end, tz),
  }));
}

/** Loads a timesheet the caregiver owns and asserts it is still editable. */
export async function editableSheet(admin: AnyDb, memberId: string, timesheetId: string) {
  const { data, error } = await admin.from("timesheets").select("*").eq("id", timesheetId).single();
  if (error || !data || data.family_member_id !== memberId) throw new Error("Timesheet not found");
  if (data.status !== "draft" && data.status !== "needs_correction") {
    throw new Error(data.status === "closed" ? "This timesheet was closed" : "This timesheet has been submitted and can't be edited");
  }
  const start = await timesheetStartDate(admin, memberId);
  if (start && data.period_end < start) throw new Error("This pay period is before your Timesheet start date");
  return data as any;
}
