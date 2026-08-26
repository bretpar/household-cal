/**
 * Pre-send calendar refresh for scheduled email summaries.
 *
 * Five minutes before a schedule's local send time the scheduler asks this
 * module to pull the household's connected Google calendars that the schedule's
 * recipients actually read, so the email is built from data that was refreshed
 * moments earlier. It reuses the normal Google sync pipeline
 * (`pullSelectedSources`), so it cannot create duplicate imports or events.
 *
 * Idempotency: one `email_summary_presyncs` row per (schedule, period). The
 * unique index makes the claim the lock — a retried or overlapping scheduler run
 * finds the row and returns instead of syncing again. A failed attempt may be
 * retried a small, fixed number of times; after that the send goes ahead with
 * the most recently synced data. The refresh never blocks or delays the email,
 * and its outcome is never shown to a recipient.
 */

export const PRESEND_LEAD_MS = 5 * 60 * 1000;
/** Total pre-send sync attempts per period, including the first one. */
export const PRESEND_MAX_ATTEMPTS = 2;
/** A claim older than this is treated as abandoned (crashed run). */
const STALE_CLAIM_MS = 4 * 60 * 1000;

type AnyDb = { from: (table: string) => any };

export type PresendStatus =
  | "refreshed"
  | "not_connected"
  | "no_calendars"
  | "already_done"
  | "in_progress"
  | "exhausted"
  | "failed";

export interface PresendResult {
  schedule_id: string;
  period_key: string;
  status: PresendStatus;
  applied?: number;
  detail?: string;
}

/**
 * Which of the household's calendars this schedule actually needs.
 *
 * `null` means "all of them": a recipient with no explicit calendar selection
 * reads every calendar, so nothing can be narrowed away for that schedule.
 */
export async function relevantSourceIds(
  admin: AnyDb,
  scheduleId: string,
): Promise<string[] | null> {
  const { data } = await admin
    .from("email_schedule_recipients")
    .select("id, unsubscribed_at, email_schedule_recipient_calendars(calendar_source_id)")
    .eq("schedule_id", scheduleId);

  const recipients = ((data ?? []) as any[]).filter((r) => !r.unsubscribed_at);
  const ids = new Set<string>();
  for (const recipient of recipients) {
    const selection = (recipient.email_schedule_recipient_calendars ?? []) as {
      calendar_source_id: string;
    }[];
    if (selection.length === 0) return null;
    for (const row of selection) ids.add(row.calendar_source_id);
  }
  return [...ids];
}

interface ClaimOutcome {
  granted: boolean;
  status?: PresendStatus;
}

async function claim(
  admin: AnyDb,
  familyId: string,
  scheduleId: string,
  periodKey: string,
): Promise<ClaimOutcome> {
  const insert = await admin.from("email_summary_presyncs").insert({
    family_id: familyId,
    schedule_id: scheduleId,
    period_key: periodKey,
    status: "running",
    attempts: 1,
  });
  if (!insert.error) return { granted: true };

  const { data: existing } = await admin
    .from("email_summary_presyncs")
    .select("id, status, attempts, started_at")
    .eq("schedule_id", scheduleId)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (!existing) return { granted: false, status: "in_progress" };

  if (existing.status === "ok" || existing.status === "skipped") {
    return { granted: false, status: "already_done" };
  }
  if (existing.status === "running") {
    const age = Date.now() - Date.parse(existing.started_at);
    if (age < STALE_CLAIM_MS) return { granted: false, status: "in_progress" };
  }
  if ((existing.attempts ?? 1) >= PRESEND_MAX_ATTEMPTS) {
    return { granted: false, status: "exhausted" };
  }

  await admin
    .from("email_summary_presyncs")
    .update({
      status: "running",
      attempts: (existing.attempts ?? 1) + 1,
      started_at: new Date().toISOString(),
      detail: null,
    })
    .eq("id", existing.id);
  return { granted: true };
}

async function finish(
  admin: AnyDb,
  scheduleId: string,
  periodKey: string,
  status: "ok" | "failed" | "skipped",
  detail?: string,
): Promise<void> {
  await admin
    .from("email_summary_presyncs")
    .update({
      status,
      detail: detail ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("schedule_id", scheduleId)
    .eq("period_key", periodKey);
}

export interface PresendDeps {
  /** Injected in tests; defaults to the real Google sync pipeline. */
  pull?: (
    admin: AnyDb,
    familyId: string,
    sourceIds: string[] | null,
  ) => Promise<{ applied?: number; failed?: number; skipped?: string }>;
}

async function defaultPull(
  admin: AnyDb,
  familyId: string,
  sourceIds: string[] | null,
): Promise<{ applied?: number; failed?: number; skipped?: string }> {
  const { pullSelectedSources } = await import("@/lib/google/sync.server");
  return pullSelectedSources(admin as never, familyId, sourceIds);
}

/**
 * Refreshes the calendars this schedule needs, at most once per period.
 *
 * Safe to call from both the T-5 pre-send pass and the send pass: whichever runs
 * first does the work, the other one returns `already_done`.
 */
export async function refreshForSchedule(
  admin: AnyDb,
  schedule: { id: string; family_id: string },
  periodKey: string,
  deps: PresendDeps = {},
): Promise<PresendResult> {
  const base = { schedule_id: schedule.id, period_key: periodKey };
  const claimed = await claim(admin, schedule.family_id, schedule.id, periodKey);
  if (!claimed.granted) return { ...base, status: claimed.status ?? "in_progress" };

  const pull = deps.pull ?? defaultPull;
  try {
    const result = await pull(admin, schedule.family_id, await relevantSourceIds(admin, schedule.id));
    if (result.skipped === "not_connected") {
      await finish(admin, schedule.id, periodKey, "skipped", "not_connected");
      return { ...base, status: "not_connected" };
    }
    if (result.skipped === "no_google_calendar") {
      await finish(admin, schedule.id, periodKey, "skipped", "no_google_calendar");
      return { ...base, status: "no_calendars" };
    }
    if (result.skipped || (result.failed ?? 0) > 0) {
      const detail = result.skipped ?? `${result.failed} calendar(s) failed to sync`;
      await finish(admin, schedule.id, periodKey, "failed", detail);
      console.error("[summary-presync] pre-send refresh failed", schedule.id, periodKey, detail);
      return { ...base, status: "failed", detail };
    }
    await finish(admin, schedule.id, periodKey, "ok");
    return { ...base, status: "refreshed", applied: result.applied ?? 0 };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await finish(admin, schedule.id, periodKey, "failed", detail);
    console.error("[summary-presync] pre-send refresh threw", schedule.id, periodKey, detail);
    return { ...base, status: "failed", detail };
  }
}

/**
 * Best-effort refresh for "Send preview", where there is no period to key off.
 * Bounded and swallowed: a sync problem must never stop the owner's preview.
 */
export async function refreshForPreview(
  admin: AnyDb,
  schedule: { id: string; family_id: string },
  deps: PresendDeps = {},
): Promise<{ refreshed: boolean; detail?: string }> {
  const pull = deps.pull ?? defaultPull;
  try {
    const result = await pull(admin, schedule.family_id, await relevantSourceIds(admin, schedule.id));
    if (result.skipped || (result.failed ?? 0) > 0) {
      console.error(
        "[summary-presync] preview refresh incomplete",
        schedule.id,
        result.skipped ?? result.failed,
      );
      return { refreshed: false, detail: result.skipped ?? "sync_failed" };
    }
    return { refreshed: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[summary-presync] preview refresh threw", schedule.id, detail);
    return { refreshed: false, detail };
  }
}
