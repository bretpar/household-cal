/**
 * Server-side sending of scheduled calendar summaries.
 *
 * Triggered by the database scheduler (see the public dispatch route), never by
 * someone opening the app. Each recipient's email is rendered independently from
 * only the calendars selected for that recipient, using data read at send time.
 * A row in `email_summary_sends` (unique per recipient + period) is claimed
 * before the email goes out, so a retried job can never send twice.
 */

import { sendTemplateEmail } from "@/lib/email-templates/send-email";

import {
  buildSummaryDays,
  eventsForSelection,
  summaryCopy,
  type SummaryEvent,
  type SummaryMember,
} from "./summary";
import { dueRun, previewWindow, type SummaryFrequency, type SummaryWindow } from "./window";

export const SITE_URL = "https://ourfamilycalendar.com";
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

type AnyDb = { from: (table: string) => any };

export interface ScheduleRow {
  id: string;
  family_id: string;
  name: string;
  frequency: SummaryFrequency;
  send_time: string;
  enabled: boolean;
}

export interface RecipientRow {
  id: string;
  schedule_id: string;
  family_id: string;
  name: string;
  email: string;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
  calendar_source_ids: string[];
}

interface HouseholdData {
  timezone: string;
  members: SummaryMember[];
  events: SummaryEvent[];
  mainSourceId: string | null;
}

async function loadHousehold(admin: AnyDb, familyId: string): Promise<HouseholdData> {
  const [familyRes, membersRes, sourcesRes, eventsRes] = await Promise.all([
    admin.from("families").select("id, timezone").eq("id", familyId).maybeSingle(),
    admin.from("family_members").select("id, initial, color, active").eq("family_id", familyId),
    admin.from("calendar_sources").select("id, is_main, display_mode").eq("family_id", familyId),
    admin
      .from("events")
      .select("*, event_members(family_member_id, weekdays)")
      .eq("family_id", familyId),
  ]);

  const sources = (sourcesRes.data ?? []) as {
    id: string;
    is_main: boolean;
    display_mode: string;
  }[];
  const displayModeOf = new Map(sources.map((s) => [s.id, s.display_mode]));

  const events: SummaryEvent[] = ((eventsRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: e.all_day,
    calendar_source_id: e.calendar_source_id,
    display_mode: e.calendar_source_id
      ? (displayModeOf.get(e.calendar_source_id) ?? "events")
      : "events",
    recurrence_rule: e.recurrence_rule,
    recurrence_until: e.recurrence_until,
    excluded_dates: e.excluded_dates ?? [],
    participants: (e.event_members ?? []).map((m: any) => ({
      member_id: m.family_member_id,
      weekdays: m.weekdays ?? null,
    })),
    member_ids: (e.event_members ?? []).map((m: any) => m.family_member_id),
  }));

  return {
    timezone: (familyRes.data?.timezone as string) || DEFAULT_TIMEZONE,
    members: ((membersRes.data ?? []) as any[]).map((m) => ({
      id: m.id,
      initial: m.initial,
      color: m.color,
    })),
    events,
    mainSourceId: sources.find((s) => s.is_main)?.id ?? sources[0]?.id ?? null,
  };
}

async function loadRecipients(admin: AnyDb, scheduleId: string): Promise<RecipientRow[]> {
  const { data } = await admin
    .from("email_schedule_recipients")
    .select("*, email_schedule_recipient_calendars(calendar_source_id)")
    .eq("schedule_id", scheduleId)
    .order("created_at", { ascending: true });
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    schedule_id: r.schedule_id,
    family_id: r.family_id,
    name: r.name,
    email: r.email,
    unsubscribe_token: r.unsubscribe_token,
    unsubscribed_at: r.unsubscribed_at,
    calendar_source_ids: (r.email_schedule_recipient_calendars ?? []).map(
      (c: any) => c.calendar_source_id,
    ),
  }));
}

export interface RenderedSummary {
  subject: string;
  templateData: Record<string, unknown>;
  dayCount: number;
}

/** Builds one recipient's email content. Exported so previews use the real path. */
export function renderSummary(
  household: HouseholdData,
  recipient: Pick<RecipientRow, "calendar_source_ids" | "unsubscribe_token">,
  frequency: SummaryFrequency,
  window: SummaryWindow,
): RenderedSummary {
  const events = eventsForSelection(household.events, {
    sourceIds: recipient.calendar_source_ids,
    mainSourceId: household.mainSourceId,
  });
  const days = buildSummaryDays(events, window, household.timezone, household.members);
  const copy = summaryCopy(frequency, window);
  return {
    subject: copy.subject,
    dayCount: days.length,
    templateData: {
      subject: copy.subject,
      heading: copy.heading,
      intro: copy.intro,
      emptyMessage: copy.emptyMessage,
      days: days.map((day) => ({
        label: day.label,
        items: day.items.map((item) => ({
          title: item.title,
          time: item.time,
          badges: item.badges,
        })),
      })),
      calendarUrl: SITE_URL,
      unsubscribeUrl: `${SITE_URL}/unsubscribe/${recipient.unsubscribe_token}`,
    },
  };
}

export interface ScheduleRunResult {
  schedule_id: string;
  status: "sent" | "skipped" | "not_due";
  period_key?: string;
  sent: number;
  skipped: number;
  failed: number;
}

/** Runs one schedule if its send time has passed and it has not been sent yet. */
export async function runSchedule(
  admin: AnyDb,
  schedule: ScheduleRow,
  now: Date = new Date(),
): Promise<ScheduleRunResult> {
  const household = await loadHousehold(admin, schedule.family_id);
  const due = dueRun(schedule, now, household.timezone);
  if (!due) {
    return { schedule_id: schedule.id, status: "not_due", sent: 0, skipped: 0, failed: 0 };
  }

  const recipients = (await loadRecipients(admin, schedule.id)).filter((r) => !r.unsubscribed_at);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipient of recipients) {
    // Claim the (recipient, period) slot first — the unique index makes a
    // retried job a no-op instead of a second email.
    const claim = await admin.from("email_summary_sends").insert({
      family_id: schedule.family_id,
      schedule_id: schedule.id,
      recipient_id: recipient.id,
      period_key: due.window.periodKey,
      status: "sending",
    });
    if (claim.error) {
      skipped += 1;
      continue;
    }

    const rendered = renderSummary(household, recipient, schedule.frequency, due.window);
    try {
      const result = await sendTemplateEmail("calendar-summary", recipient.email, {
        idempotencyKey: `summary-${recipient.id}-${due.window.periodKey}`,
        templateData: rendered.templateData,
      });
      if (result.sent) sent += 1;
      else failed += 1;
      await admin
        .from("email_summary_sends")
        .update({ status: result.sent ? "sent" : "suppressed" })
        .eq("recipient_id", recipient.id)
        .eq("period_key", due.window.periodKey);
    } catch (error) {
      failed += 1;
      await admin
        .from("email_summary_sends")
        .update({ status: "failed", detail: String((error as Error)?.message ?? error) })
        .eq("recipient_id", recipient.id)
        .eq("period_key", due.window.periodKey);
    }
  }

  return {
    schedule_id: schedule.id,
    status: "sent",
    period_key: due.window.periodKey,
    sent,
    skipped,
    failed,
  };
}

/** Called by the scheduler: every enabled schedule across all households. */
export async function dispatchDueSummaries(
  admin: AnyDb,
  now: Date = new Date(),
): Promise<{ schedules: number; results: ScheduleRunResult[] }> {
  const { data } = await admin
    .from("email_schedules")
    .select("id, family_id, name, frequency, send_time, enabled")
    .eq("enabled", true);
  const schedules = (data ?? []) as ScheduleRow[];
  const results: ScheduleRunResult[] = [];
  for (const schedule of schedules) {
    try {
      results.push(await runSchedule(admin, schedule, now));
    } catch (error) {
      console.error("summary schedule failed", schedule.id, error);
      results.push({
        schedule_id: schedule.id,
        status: "skipped",
        sent: 0,
        skipped: 0,
        failed: 1,
      });
    }
  }
  return { schedules: schedules.length, results };
}

/**
 * Owner-facing preview: renders exactly what the recipient would get for the
 * current period and sends it to one address without touching send history.
 */
export async function sendSummaryPreview(
  admin: AnyDb,
  schedule: ScheduleRow,
  recipientId: string | null,
  to: string,
): Promise<{ sent: boolean; subject: string; dayCount: number }> {
  const household = await loadHousehold(admin, schedule.family_id);
  const recipients = await loadRecipients(admin, schedule.id);
  const recipient =
    (recipientId ? recipients.find((r) => r.id === recipientId) : recipients[0]) ?? null;
  const window = previewWindow(schedule.frequency, new Date(), household.timezone);
  const rendered = renderSummary(
    household,
    recipient ?? { calendar_source_ids: [], unsubscribe_token: "preview" },
    schedule.frequency,
    window,
  );
  const result = await sendTemplateEmail("calendar-summary", to, {
    idempotencyKey: `summary-preview-${schedule.id}-${recipient?.id ?? "all"}-${Date.now()}`,
    templateData: { ...rendered.templateData, subject: `${rendered.subject} (preview)` },
  });
  return { sent: result.sent, subject: rendered.subject, dayCount: rendered.dayCount };
}

/** Unsubscribes exactly one recipient using their opaque token. */
export async function unsubscribeByToken(
  admin: AnyDb,
  token: string,
): Promise<{ ok: boolean; name?: string }> {
  if (!token || token.length < 16) return { ok: false };
  const { data } = await admin
    .from("email_schedule_recipients")
    .select("id, name")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!data?.id) return { ok: false };
  await admin
    .from("email_schedule_recipients")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", data.id);
  return { ok: true, name: data.name as string };
}
