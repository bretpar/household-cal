/**
 * Owner-only reads and writes for scheduled email summaries.
 *
 * Runs with the caller's RLS-scoped client, so the owner-only policies on the
 * schedule tables are the real gate; `requireOwner` gives a friendly error
 * instead of a policy failure.
 */

import type { Db } from "@/lib/calendar-ops";
import { requireOwner, resolveCurrentFamily } from "@/lib/household.server";

import { DEFAULT_TIMEZONE } from "./dispatch.server";
import type { SummaryFrequency } from "./window";

export interface RecipientView {
  id: string;
  name: string;
  email: string;
  family_member_id: string | null;
  unsubscribed_at: string | null;
  calendar_source_ids: string[];
  weekdays: string[];
}

export interface ScheduleView {
  id: string;
  name: string;
  frequency: SummaryFrequency;
  send_time: string;
  enabled: boolean;
  recipients: RecipientView[];
  last_sent_at: string | null;
}

export interface EmailSummaryData {
  family_id: string | null;
  timezone: string;
  is_owner: boolean;
  schedules: ScheduleView[];
}

export function assertFrequency(value: unknown): SummaryFrequency {
  if (value === "daily" || value === "weekly" || value === "monthly") return value;
  throw new Error("Choose daily, weekly or monthly");
}

export function normalizeSendTime(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) throw new Error("Choose a valid send time");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Choose a valid send time");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export function normalizeEmailAddress(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
  return email;
}

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Empty means every day; codes are stored in canonical Mon-first order. */
export function normalizeWeekdays(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map((v) => String(v).toUpperCase()) : [];
  const picked = WEEKDAY_CODES.filter((code) => raw.includes(code));
  return picked.length === WEEKDAY_CODES.length ? [] : [...picked];
}

export async function loadEmailSummaries(db: Db, userId: string): Promise<EmailSummaryData> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) {
    return { family_id: null, timezone: DEFAULT_TIMEZONE, is_owner: false, schedules: [] };
  }
  const isOwner = current.role === "owner";
  const { data: familyRow } = await db
    .from("families")
    .select("timezone")
    .eq("id", current.familyId)
    .maybeSingle();
  const timezone = (familyRow?.timezone as string) || DEFAULT_TIMEZONE;
  if (!isOwner) {
    return { family_id: current.familyId, timezone, is_owner: false, schedules: [] };
  }

  const { data, error } = await db
    .from("email_schedules")
    .select(
      "id, name, frequency, send_time, enabled, email_schedule_recipients(id, name, email, family_member_id, unsubscribed_at, weekdays, email_schedule_recipient_calendars(calendar_source_id))",
    )
    .eq("family_id", current.familyId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const { data: sends } = await db
    .from("email_summary_sends")
    .select("schedule_id, created_at")
    .eq("family_id", current.familyId)
    .order("created_at", { ascending: false });
  const lastSentOf = new Map<string, string>();
  for (const row of (sends ?? []) as { schedule_id: string; created_at: string }[]) {
    if (!lastSentOf.has(row.schedule_id)) lastSentOf.set(row.schedule_id, row.created_at);
  }

  const schedules: ScheduleView[] = ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    frequency: s.frequency,
    send_time: String(s.send_time).slice(0, 5),
    enabled: s.enabled,
    last_sent_at: lastSentOf.get(s.id) ?? null,
    recipients: (s.email_schedule_recipients ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      family_member_id: r.family_member_id,
      unsubscribed_at: r.unsubscribed_at,
      calendar_source_ids: (r.email_schedule_recipient_calendars ?? []).map(
        (c: any) => c.calendar_source_id,
      ),
      weekdays: (r.weekdays ?? []) as string[],
    })),
  }));

  return { family_id: current.familyId, timezone, is_owner: true, schedules };
}

async function ownerFamily(db: Db, userId: string): Promise<string> {
  const current = await resolveCurrentFamily(db, userId);
  if (!current) throw new Error("No household found");
  await requireOwner(db, userId, current.familyId);
  return current.familyId;
}

export async function saveHouseholdTimezone(
  db: Db,
  userId: string,
  timezone: string,
): Promise<void> {
  const familyId = await ownerFamily(db, userId);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("Choose a valid timezone");
  }
  const { error } = await db.from("families").update({ timezone }).eq("id", familyId);
  if (error) throw error;
}

export async function saveSchedule(
  db: Db,
  userId: string,
  input: {
    id?: string | null;
    name: string;
    frequency: unknown;
    send_time: unknown;
    enabled?: boolean;
  },
): Promise<{ id: string }> {
  const familyId = await ownerFamily(db, userId);
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Name this schedule");
  const patch = {
    name,
    frequency: assertFrequency(input.frequency),
    send_time: normalizeSendTime(input.send_time),
    ...(input.enabled === undefined ? {} : { enabled: Boolean(input.enabled) }),
  };
  if (input.id) {
    const { error } = await db
      .from("email_schedules")
      .update(patch)
      .eq("id", input.id)
      .eq("family_id", familyId);
    if (error) throw error;
    return { id: input.id };
  }
  const { data, error } = await db
    .from("email_schedules")
    .insert({ family_id: familyId, created_by: userId, enabled: false, ...patch })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function setScheduleEnabled(
  db: Db,
  userId: string,
  scheduleId: string,
  enabled: boolean,
): Promise<void> {
  const familyId = await ownerFamily(db, userId);
  if (enabled) {
    const { data } = await db
      .from("email_schedule_recipients")
      .select("id")
      .eq("schedule_id", scheduleId)
      .is("unsubscribed_at", null)
      .limit(1);
    if (!data?.[0]) throw new Error("Add at least one recipient before enabling this schedule");
  }
  const { error } = await db
    .from("email_schedules")
    .update({ enabled })
    .eq("id", scheduleId)
    .eq("family_id", familyId);
  if (error) throw error;
}

export async function deleteSchedule(db: Db, userId: string, scheduleId: string): Promise<void> {
  const familyId = await ownerFamily(db, userId);
  const { error } = await db
    .from("email_schedules")
    .delete()
    .eq("id", scheduleId)
    .eq("family_id", familyId);
  if (error) throw error;
}

export async function saveRecipient(
  db: Db,
  userId: string,
  input: {
    id?: string | null;
    schedule_id: string;
    name: string;
    email: unknown;
    family_member_id?: string | null;
    calendar_source_ids?: string[];
    weekdays?: string[] | null;
    resubscribe?: boolean;
  },
): Promise<{ id: string }> {
  const familyId = await ownerFamily(db, userId);
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Add a name for this recipient");
  const email = normalizeEmailAddress(input.email);

  let recipientId = input.id ?? null;
  const patch = {
    name,
    email,
    family_member_id: input.family_member_id ?? null,
    weekdays: normalizeWeekdays(input.weekdays),
    ...(input.resubscribe ? { unsubscribed_at: null } : {}),
  };
  if (recipientId) {
    const { error } = await db
      .from("email_schedule_recipients")
      .update(patch)
      .eq("id", recipientId)
      .eq("family_id", familyId);
    if (error) throw error;
  } else {
    const { data, error } = await db
      .from("email_schedule_recipients")
      .insert({ family_id: familyId, schedule_id: input.schedule_id, ...patch })
      .select("id")
      .single();
    if (error) throw error;
    recipientId = data.id as string;
  }

  // per-recipient calendar selection: replace the whole set
  const sourceIds = [...new Set(input.calendar_source_ids ?? [])];
  await db
    .from("email_schedule_recipient_calendars")
    .delete()
    .eq("recipient_id", recipientId as string);
  if (sourceIds.length > 0) {
    const { error } = await db.from("email_schedule_recipient_calendars").insert(
      sourceIds.map((calendar_source_id) => ({
        recipient_id: recipientId as string,
        calendar_source_id,
      })),
    );
    if (error) throw error;
  }
  return { id: recipientId as string };
}

export async function deleteRecipient(db: Db, userId: string, recipientId: string): Promise<void> {
  const familyId = await ownerFamily(db, userId);
  const { error } = await db
    .from("email_schedule_recipients")
    .delete()
    .eq("id", recipientId)
    .eq("family_id", familyId);
  if (error) throw error;
}

/** Owner-scoped lookup used before a preview send. */
export async function loadOwnedSchedule(
  db: Db,
  userId: string,
  scheduleId: string,
): Promise<{
  id: string;
  family_id: string;
  name: string;
  frequency: SummaryFrequency;
  send_time: string;
  enabled: boolean;
}> {
  const familyId = await ownerFamily(db, userId);
  const { data, error } = await db
    .from("email_schedules")
    .select("id, family_id, name, frequency, send_time, enabled")
    .eq("id", scheduleId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Schedule not found");
  return data as any;
}
