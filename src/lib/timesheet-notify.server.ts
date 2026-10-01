/**
 * Timesheet email notifications. Server-only. Every send is claimed first in
 * `timesheet_notifications` (unique family/kind/version/recipient), so retries
 * and repeated scheduler runs never send twice. Content is built only from the
 * timesheet row, its entries or its submission snapshot.
 */
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { formatHours, hoursBetween } from "@/lib/timesheet-periods";
import { adminDb, ensureTimesheet, loadEntries } from "@/lib/timesheets.server";

type AnyDb = { from: (t: string) => any; rpc: (f: string, a: unknown) => any; auth?: any };

const SITE_URL = "https://ourfamilycalendar.com";
const REMINDER_DELAY_MS = 24 * 3_600_000;

export interface NotifySettings {
  notify_ready: boolean;
  notify_reminder: boolean;
  notify_owner_submit: boolean;
  notify_correction: boolean;
  notify_approved: boolean;
}
export const DEFAULT_NOTIFY: NotifySettings = {
  notify_ready: true, notify_reminder: true, notify_owner_submit: true, notify_correction: true, notify_approved: true,
};

export async function loadNotifySettings(db: AnyDb, familyId: string): Promise<NotifySettings> {
  const { data, error } = await db
    .from("timesheet_settings")
    .select("notify_ready, notify_reminder, notify_owner_submit, notify_correction, notify_approved")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NotifySettings | null) ?? DEFAULT_NOTIFY;
}

const fmtDate = (key: string, year = false) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC",
  });
const periodLabel = (s: { period_start: string; period_end: string }) =>
  `${fmtDate(s.period_start)} – ${fmtDate(s.period_end, true)}`;
const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
const totalHours = (entries: { actual_start: string; actual_end: string }[]) =>
  formatHours(entries.reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0));

async function emailForUser(admin: AnyDb, userId: string): Promise<string | null> {
  const { data } = await (admin as any).auth.admin.getUserById(userId);
  return (data?.user?.email as string | undefined) ?? null;
}

async function householdName(admin: AnyDb, familyId: string) {
  const { data } = await admin.from("families").select("name").eq("id", familyId).maybeSingle();
  return (data?.name as string | undefined) ?? "your family";
}

/** The caregiver's sign-in email + opt-in state, or null if she has no linked login. */
async function caregiverRecipient(admin: AnyDb, familyId: string, memberId: string) {
  const [m, fu] = await Promise.all([
    admin.from("family_members").select("timesheet_emails_enabled, active, removed_at").eq("id", memberId).maybeSingle(),
    admin.from("family_users").select("user_id").eq("family_id", familyId).eq("family_member_id", memberId).limit(1),
  ]);
  const userId = fu.data?.[0]?.user_id as string | undefined;
  if (!m.data || !m.data.active || m.data.removed_at || !userId) return null;
  const email = await emailForUser(admin, userId);
  return email ? { email, optedIn: m.data.timesheet_emails_enabled !== false } : null;
}

async function ownerEmails(admin: AnyDb, familyId: string): Promise<string[]> {
  const { data } = await admin.from("family_users").select("user_id").eq("family_id", familyId).eq("role", "owner");
  const out: string[] = [];
  for (const r of data ?? []) {
    const e = await emailForUser(admin, r.user_id);
    if (e) out.push(e);
  }
  return out;
}

/** Claim → send → mark. Returns false when this exact notification was already handled. */
async function claimAndSend(
  admin: AnyDb,
  row: { family_id: string; timesheet_id?: string | null; family_member_id?: string | null; kind: string; version_key: string; recipient: string },
  template: string,
  templateData: Record<string, unknown>,
): Promise<boolean> {
  const ins = await admin.from("timesheet_notifications").insert({ ...row, status: "claimed" }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return false;
    throw new Error(ins.error.message);
  }
  const id = ins.data.id as string;
  try {
    const result = await sendTemplateEmail(template, row.recipient, {
      templateData,
      idempotencyKey: `ts-${row.kind}-${row.version_key}-${row.recipient}`,
    });
    await admin.from("timesheet_notifications").update({ status: result.sent ? "sent" : "suppressed" }).eq("id", id);
    return result.sent;
  } catch (error) {
    // Release the claim so a later run (scheduled kinds) can retry.
    await admin.from("timesheet_notifications").delete().eq("id", id);
    throw error;
  }
}

const sheetUrl = (periodStart: string) => `${SITE_URL}/timesheet?period=${periodStart}`;

/* ------------------------------------------------------------ inline hooks */

/** After a caregiver submits/resubmits. Never throws. */
export async function notifyTimesheetSubmitted(timesheetId: string) {
  try {
    const admin = await adminDb();
    const { data: t } = await admin.from("timesheets").select("*").eq("id", timesheetId).single();
    if (!t || t.status !== "submitted") return;
    const settings = await loadNotifySettings(admin, t.family_id);
    if (!settings.notify_owner_submit) return;
    for (const email of await ownerEmails(admin, t.family_id)) {
      await claimAndSend(
        admin,
        { family_id: t.family_id, timesheet_id: t.id, kind: "submitted", version_key: `${t.id}:${t.submitted_at}`, recipient: email },
        "timesheet-submitted",
        {
          caregiverName: t.snapshot?.caregiver_name ?? t.caregiver_name,
          periodLabel: periodLabel(t),
          url: `${SITE_URL}/activities?tab=timesheets&timesheet=${t.id}`,
        },
      );
    }
  } catch (e) {
    console.error("[timesheet-notify] submitted email failed", e instanceof Error ? e.message : e);
  }
}

/** After an owner approves or requests a correction. Never throws. */
export async function notifyTimesheetReviewed(timesheetId: string) {
  try {
    const admin = await adminDb();
    const { data: t } = await admin.from("timesheets").select("*").eq("id", timesheetId).single();
    if (!t) return;
    const settings = await loadNotifySettings(admin, t.family_id);
    const isApproved = t.status === "approved";
    if (isApproved ? !settings.notify_approved : t.status !== "needs_correction" || !settings.notify_correction) return;
    const who = await caregiverRecipient(admin, t.family_id, t.family_member_id);
    if (!who?.optedIn) return;
    await claimAndSend(
      admin,
      {
        family_id: t.family_id, timesheet_id: t.id, family_member_id: t.family_member_id,
        kind: isApproved ? "approved" : "correction", version_key: `${t.id}:${t.reviewed_at}`, recipient: who.email,
      },
      isApproved ? "timesheet-approved" : "timesheet-correction",
      isApproved
        ? { periodLabel: periodLabel(t), totalHours: totalHours(t.snapshot?.entries ?? []) }
        : { periodLabel: periodLabel(t), note: t.parent_note, url: sheetUrl(t.period_start) },
    );
  } catch (e) {
    console.error("[timesheet-notify] review email failed", e instanceof Error ? e.message : e);
  }
}

/** Caregiver turned timesheet emails off: tell owners once per transition. Never throws. */
export async function notifyOwnersOptOut(familyId: string, memberId: string, changedAt: string) {
  try {
    const admin = await adminDb();
    const { data: m } = await admin.from("family_members").select("name").eq("id", memberId).single();
    const name = await householdName(admin, familyId);
    for (const email of await ownerEmails(admin, familyId)) {
      await claimAndSend(
        admin,
        { family_id: familyId, family_member_id: memberId, kind: "opt_out", version_key: `${memberId}:${changedAt}`, recipient: email },
        "timesheet-emails-off",
        { caregiverName: m?.name, householdName: name },
      );
    }
  } catch (e) {
    console.error("[timesheet-notify] opt-out email failed", e instanceof Error ? e.message : e);
  }
}

/* --------------------------------------------------------------- scheduler */

/** Hourly: pay-period-ready emails for periods that just ended, then one-time reminders. */
export async function runTimesheetNotifications(now = new Date()) {
  const admin = await adminDb();
  let ready = 0;
  let reminders = 0;
  const failures: string[] = [];

  const { data: links, error } = await admin
    .from("family_users")
    .select("family_id, family_member_id, family_members!inner(role, active, removed_at)")
    .not("family_member_id", "is", null);
  if (error) throw new Error(error.message);

  for (const l of links ?? []) {
    const m = l.family_members;
    if (!m || m.role !== "caregiver" || !m.active || m.removed_at) continue;
    try {
      const settings = await loadNotifySettings(admin, l.family_id);
      if (!settings.notify_ready) continue;
      const who = await caregiverRecipient(admin, l.family_id, l.family_member_id);
      if (!who?.optedIn) continue;
      // offset -1 = the most recently ended pay period; creates/refreshes the draft.
      const { sheet, timeZone } = await ensureTimesheet(admin, l.family_id, l.family_member_id, -1);
      if (sheet.status !== "draft") continue;
      const entries = await loadEntries(admin, sheet.id, timeZone);
      if (entries.length === 0) continue;
      const scheduled = entries.reduce(
        (n: number, e: any) => n + (e.scheduled_start && e.scheduled_end ? hoursBetween(e.scheduled_start, e.scheduled_end) : 0), 0,
      );
      const sent = await claimAndSend(
        admin,
        { family_id: l.family_id, timesheet_id: sheet.id, family_member_id: l.family_member_id, kind: "ready", version_key: sheet.id, recipient: who.email },
        "timesheet-ready",
        {
          householdName: await householdName(admin, l.family_id), periodLabel: periodLabel(sheet),
          scheduledHours: scheduled > 0 ? formatHours(scheduled) : undefined, url: sheetUrl(sheet.period_start),
        },
      );
      if (sent) ready++;
    } catch (e) {
      failures.push(e instanceof Error ? e.message : "unknown");
    }
  }

  // Reminders: one per ready/correction notification, 24h later, only if still unsubmitted.
  const cutoff = new Date(now.getTime() - REMINDER_DELAY_MS).toISOString();
  const { data: due, error: dueErr } = await admin
    .from("timesheet_notifications")
    .select("family_id, timesheet_id, family_member_id, kind, version_key, recipient")
    .in("kind", ["ready", "correction"])
    .eq("status", "sent")
    .lt("created_at", cutoff)
    .gt("created_at", new Date(now.getTime() - 14 * 86_400_000).toISOString());
  if (dueErr) throw new Error(dueErr.message);
  for (const n of due ?? []) {
    try {
      const { data: t } = await admin.from("timesheets").select("*").eq("id", n.timesheet_id).maybeSingle();
      if (!t || (t.status !== "draft" && t.status !== "needs_correction")) continue;
      if (n.kind === "correction" && n.version_key !== `${t.id}:${t.reviewed_at}`) continue;
      const settings = await loadNotifySettings(admin, n.family_id);
      if (!settings.notify_reminder) continue;
      const who = await caregiverRecipient(admin, n.family_id, t.family_member_id);
      if (!who?.optedIn) continue;
      const sent = await claimAndSend(
        admin,
        { family_id: n.family_id, timesheet_id: t.id, family_member_id: t.family_member_id, kind: "reminder", version_key: `${n.kind}:${n.version_key}`, recipient: who.email },
        "timesheet-reminder",
        { householdName: await householdName(admin, n.family_id), periodLabel: periodLabel(t), url: sheetUrl(t.period_start) },
      );
      if (sent) reminders++;
    } catch (e) {
      failures.push(e instanceof Error ? e.message : "unknown");
    }
  }

  if (failures.length) throw new Error(`${failures.length} timesheet notification(s) failed: ${failures[0]}`);
  return { ready, reminders };
}

