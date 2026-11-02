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

export type AnyDb = { from: (t: string) => any; rpc: (f: string, a: unknown) => any };

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

/** Household master switch (families.timesheets_enabled). Off = history is read-only. */
export async function householdTimesheetsOn(familyId: string): Promise<boolean> {
  const { data } = await (await adminDb()).from("families").select("timesheets_enabled").eq("id", familyId).maybeSingle();
  return data?.timesheets_enabled === true;
}

export type TimesheetAccess = "write" | "read";

async function assertHouseholdMode(familyId: string, mode: TimesheetAccess) {
  if (mode === "write" && !(await householdTimesheetsOn(familyId))) {
    throw new Error("Timesheets are turned off for this household");
  }
}

export async function assertOwner(userDb: AnyDb, familyId: string, mode: TimesheetAccess = "write") {
  assertFeature("timesheets", { familyId });
  const { data, error } = await userDb.rpc("is_family_owner", { _family_id: familyId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only the household owner can do this");
  await assertHouseholdMode(familyId, mode);
}

/** The signed-in caregiver's own member id (via verified session), or an error. */
export async function myCaregiver(userDb: AnyDb, userId: string, mode: TimesheetAccess = "write") {
  const familyId = await currentFamilyId(userDb, userId);
  assertFeature("timesheets", { familyId });
  const { data, error } = await userDb.rpc("my_caregiver_member_id", { _family_id: familyId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Timesheets are only available to caregivers");
  const m = await (await adminDb()).from("family_members").select("timesheets_enabled").eq("id", data).maybeSingle();
  if (m.data?.timesheets_enabled !== true) throw new Error("Timesheets are turned off for you in this household");
  await assertHouseholdMode(familyId, mode);
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
  const today = todayKey(timeZone);
  const period = payPeriodFor(settings, today, offset);
  const member = await admin.from("family_members").select("timesheet_start_date").eq("id", memberId).eq("family_id", familyId).single();
  if (member.error) throw new Error(member.error.message);
  const startDate = (member.data.timesheet_start_date as string | null) ?? null;
  const shifts = (await scheduledShifts(admin, familyId, memberId, period, timeZone))
    .filter((sh) => !startDate || sh.work_date >= startDate);
  const { data: sheet, error } = await admin.rpc("refresh_timesheet_atomic", {
    _family: familyId, _member: memberId, _settings: settings, _timezone: timeZone,
    _today: today, _start: period.start, _end: period.end, _shifts: shifts,
  });
  if (error) throw new Error(error.message);
  if (!sheet) throw new Error("Timesheet not found");

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
    .select("id, event_id, work_date, scheduled_title, scheduled_start, scheduled_end, actual_start, actual_end, is_manual, note, paid_hours, paid_note, owner_edited_at, actual_time_confirmed, schedule_conflict_at, schedule_conflict_reason")
    .eq("timesheet_id", timesheetId)
    .order("actual_start", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: any) => ({
    ...e,
    paid_hours: e.paid_hours == null ? null : Number(e.paid_hours),
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

/* ------------------------------------------- shift-change reconciliation */

/** Caregiver member ids assigned to any of the given events (legacy login links resolved). */
export async function shiftMemberIds(admin: AnyDb, familyId: string, eventIds: string[]): Promise<string[]> {
  if (!eventIds.length) return [];
  const { data, error } = await admin
    .from("babysitter_shifts")
    .select("assignee_member_id, family_user_id")
    .eq("family_id", familyId)
    .in("event_id", eventIds);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  const legacyLoginIds: string[] = [];
  for (const r of data ?? []) {
    if (r.assignee_member_id) ids.add(r.assignee_member_id as string);
    else if (r.family_user_id) legacyLoginIds.push(r.family_user_id as string);
  }
  if (legacyLoginIds.length) {
    const fu = await admin.from("family_users").select("family_member_id").in("id", legacyLoginIds);
    if (fu.error) throw new Error(fu.error.message);
    for (const r of fu.data ?? []) if (r.family_member_id) ids.add(r.family_member_id as string);
  }
  return [...ids];
}

/**
 * After a caregiver shift changes, reconcile EVERY existing editable
 * (draft/needs_correction) timesheet of the affected caregivers in one
 * database transaction, so recurring-series moves update later weeks too and
 * a failure leaves no period half-updated. Never creates timesheets and never
 * touches Submitted/Approved/Closed history. Protected entries orphaned by a
 * move, and one-off shifts already recorded on a finalized sheet, are flagged
 * in the database (schedule_conflict_at) and block submission until resolved.
 * Throws on failure so callers can keep the durable retry job pending.
 */
export async function reconcileShiftTimesheets(
  admin: AnyDb,
  familyId: string,
  memberIds: string[],
): Promise<void> {
  if (!memberIds.length) return;
  if (!(await householdTimesheetsOn(familyId))) return;
  const { settings, timeZone } = await loadPaySettings(admin, familyId);
  const today = todayKey(timeZone);
  const items: { member: string; start: string; end: string; shifts: ScheduledShift[] }[] = [];
  for (const memberId of new Set(memberIds)) {
    const member = await admin
      .from("family_members")
      .select("timesheets_enabled, timesheet_start_date")
      .eq("id", memberId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (member.error) throw new Error(member.error.message);
    if (!member.data || member.data.timesheets_enabled !== true) continue;
    const startDate = (member.data.timesheet_start_date as string | null) ?? null;
    const sheets = await admin
      .from("timesheets")
      .select("period_start, period_end")
      .eq("family_id", familyId)
      .eq("family_member_id", memberId)
      .in("status", ["draft", "needs_correction"]);
    if (sheets.error) throw new Error(sheets.error.message);
    for (const sh of sheets.data ?? []) {
      const period = { start: sh.period_start as string, end: sh.period_end as string } as PayPeriod;
      const shifts = (await scheduledShifts(admin, familyId, memberId, period, timeZone))
        .filter((x) => !startDate || x.work_date >= startDate);
      items.push({ member: memberId, start: period.start, end: period.end, shifts });
    }
  }
  if (!items.length) return;
  const { error } = await admin.rpc("reconcile_shift_timesheets_atomic", {
    _family: familyId, _settings: settings, _timezone: timeZone, _today: today, _items: items,
  });
  if (error) throw new Error(error.message);
}

/** Durable reconciliation intent: recorded before a shift change, removed only after success. */
/** An empty member list is a whole-household hold: it blocks every caregiver's submit/approve until it runs. */
export async function openReconcileJob(admin: AnyDb, familyId: string, memberIds: string[]): Promise<string | null> {
  const { data, error } = await admin
    .from("timesheet_reconcile_jobs")
    .insert({ family_id: familyId, member_ids: [...new Set(memberIds)] })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Runs (or retries) a reconciliation job. Returns "ok" or "pending"; a pending
 * job stays in the table and is retried by the hourly timesheet job.
 */
export async function runReconcileJob(
  admin: AnyDb,
  familyId: string,
  jobId: string | null,
  memberIds: string[],
): Promise<"ok" | "pending"> {
  const ids = [...new Set(memberIds)];
  if (jobId) {
    const { error } = await admin.from("timesheet_reconcile_jobs").update({ member_ids: ids, updated_at: new Date().toISOString() }).eq("id", jobId);
    // Keep the original (possibly household-wide) hold if the narrowing update fails.
    if (error) console.error("reconcile job update failed", error.message);
  } else {
    jobId = await openReconcileJob(admin, familyId, ids);
  }
  try {
    // Unknown affected caregivers (empty list) means reconcile every Timesheet caregiver.
    let targets = ids;
    if (!targets.length) {
      const all = await admin.from("family_members").select("id").eq("family_id", familyId).eq("timesheets_enabled", true);
      if (all.error) throw new Error(all.error.message);
      targets = (all.data ?? []).map((m: { id: string }) => m.id);
    }
    await reconcileShiftTimesheets(admin, familyId, targets);
    if (jobId) await admin.from("timesheet_reconcile_jobs").delete().eq("id", jobId);
    return "ok";
  } catch (e) {
    console.error("timesheet reconciliation failed; left pending for retry", e);
    if (jobId) {
      const cur = await admin.from("timesheet_reconcile_jobs").select("attempts").eq("id", jobId).maybeSingle();
      await admin.from("timesheet_reconcile_jobs").update({
        attempts: ((cur.data?.attempts as number | undefined) ?? 0) + 1,
        last_error: e instanceof Error ? e.message : String(e),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    }
    return "pending";
  }
}

/** Retries pending reconciliation jobs (called by the hourly timesheet scheduler). */
export async function drainReconcileJobs(admin: AnyDb, limit = 50): Promise<{ retried: number; pending: number }> {
  const { data, error } = await admin
    .from("timesheet_reconcile_jobs")
    .select("id, family_id, member_ids")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  let pending = 0;
  for (const j of data ?? []) {
    const r = await runReconcileJob(admin, j.family_id as string, j.id as string, (j.member_ids as string[]) ?? []);
    if (r === "pending") pending++;
  }
  return { retried: (data ?? []).length, pending };
}
