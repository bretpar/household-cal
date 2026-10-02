import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PaySettings, TimesheetStatus } from "@/lib/timesheet-periods";

type AnyDb = { from: (t: string) => any; rpc: (f: string, a: unknown) => any };

export interface TimesheetEntry {
  id: string;
  event_id: string | null;
  work_date: string;
  scheduled_title: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string;
  actual_end: string;
  actual_start_local: string;
  actual_end_local: string;
  is_manual: boolean;
  note: string | null;
  /** set when a household Owner adjusted this entry during review */
  owner_edited_at?: string | null;
}

export interface TimesheetView {
  id: string;
  caregiver_name: string;
  period_start: string;
  period_end: string;
  status: TimesheetStatus;
  parent_note: string | null;
  submitted_at: string | null;
  time_zone: string;
  entries: TimesheetEntry[];
  /** finalized by a household Owner for a caregiver without sign-in access */
  owner_managed?: boolean;
}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ------------------------------------------------------------- pay settings */

export const getPaySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaySettings & { time_zone: string }> => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId); // owner + centralized Timesheet entitlement
    const { settings, timeZone } = await s.loadPaySettings(await s.adminDb(), familyId);
    return { ...settings, time_zone: timeZone };
  });

export const savePaySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
      anchor_date: dateKey,
      semimonthly_first_end: z.number().int().min(1).max(27),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    const { error } = await (await s.adminDb())
      .from("timesheet_settings")
      .upsert({ family_id: familyId, ...data }, { onConflict: "family_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------------------------------------------------------- caregiver */

export const getMyTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ offset: z.number().int().min(-60).max(0), period_start: dateKey.optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<TimesheetView & { offset: number }> => {
    const s = await import("@/lib/timesheets.server");
    const { payPeriodFor } = await import("@/lib/timesheet-periods");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    let offset = data.offset;
    if (data.period_start) {
      // Deep link from an email: resolve the period to an offset (unknown -> current).
      const { settings, timeZone } = await s.loadPaySettings(admin, me.familyId);
      const today = s.todayKey(timeZone);
      offset = 0;
      for (let o = 0; o >= -60; o--) {
        if (payPeriodFor(settings, today, o).start === data.period_start) { offset = o; break; }
      }
    }
    const { sheet, timeZone } = await s.ensureTimesheet(admin, me.familyId, me.memberId, offset);
    const fresh = (await admin.from("timesheets").select("*").eq("id", sheet.id).single()).data;
    return { ...fresh, offset, time_zone: timeZone, entries: await s.loadEntries(admin, sheet.id, timeZone) };
  });

export const saveTimesheetEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      timesheet_id: z.string().uuid(),
      entry_id: z.string().uuid().nullable(),
      work_date: dateKey,
      start: hhmm,
      end: hhmm,
      note: z.string().max(500).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    const sheet = await s.editableSheet(admin, me.memberId, data.timesheet_id);
    if (data.work_date < sheet.period_start || data.work_date > sheet.period_end) {
      throw new Error("Pick a date inside this pay period");
    }
    const { timeZone } = await s.loadPaySettings(admin, me.familyId);
    const start = s.zonedInstant(data.work_date, data.start, timeZone);
    let end = s.zonedInstant(data.work_date, data.end, timeZone);
    if (end <= start) end = new Date(end.getTime() + 86_400_000); // overnight
    const note = data.note?.trim() || null;
    if (data.entry_id) {
      const { error } = await admin
        .from("timesheet_entries")
        .update({ actual_start: start.toISOString(), actual_end: end.toISOString(), note })
        .eq("id", data.entry_id)
        .eq("timesheet_id", sheet.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("timesheet_entries").insert({
        timesheet_id: sheet.id, family_id: me.familyId, work_date: data.work_date,
        actual_start: start.toISOString(), actual_end: end.toISOString(), is_manual: true, note,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteManualEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ timesheet_id: z.string().uuid(), entry_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    const sheet = await s.editableSheet(admin, me.memberId, data.timesheet_id);
    const { error } = await admin
      .from("timesheet_entries")
      .delete()
      .eq("id", data.entry_id)
      .eq("timesheet_id", sheet.id)
      .eq("is_manual", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ timesheet_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    const sheet = await s.editableSheet(admin, me.memberId, data.timesheet_id);
    const { timeZone } = await s.loadPaySettings(admin, me.familyId);
    const entries = await s.loadEntries(admin, sheet.id, timeZone);
    const { error } = await admin
      .from("timesheets")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        snapshot: { time_zone: timeZone, caregiver_name: sheet.caregiver_name, entries },
      })
      .eq("id", sheet.id)
      .in("status", ["draft", "needs_correction"]);
    if (error) throw new Error(error.message);
    const { notifyTimesheetSubmitted } = await import("@/lib/timesheet-notify.server");
    await notifyTimesheetSubmitted(sheet.id);
    return { ok: true };
  });

/** Caregiver nav badge: ended-period drafts + needs-correction sheets. Server-authoritative. */
export const countMyTimesheetActions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const s = await import("@/lib/timesheets.server");
    let me: { familyId: string; memberId: string };
    try {
      me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    } catch {
      return { count: 0 };
    }
    const admin = await s.adminDb();
    const { timeZone } = await s.loadPaySettings(admin, me.familyId);
    const today = s.todayKey(timeZone);
    const { data, error } = await admin
      .from("timesheets")
      .select("status, period_end")
      .eq("family_member_id", me.memberId)
      .in("status", ["draft", "needs_correction"]);
    if (error) throw new Error(error.message);
    const count = (data ?? []).filter(
      (t: any) => t.status === "needs_correction" || (t.status === "draft" && t.period_end < today),
    ).length;
    return { count };
  });

/* -------------------------------------------------------------------- owner */

/** Owner badge: number of timesheets awaiting review (status = submitted). 0 for non-owners. */
export const countPendingTimesheets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const s = await import("@/lib/timesheets.server");
    const { hasFeature } = await import("@/lib/features");
    const db = context.supabase as unknown as AnyDb;
    let familyId: string;
    try {
      familyId = await s.currentFamilyId(db, context.userId);
    } catch {
      return { count: 0 };
    }
    if (!hasFeature("timesheets", { familyId })) return { count: 0 };
    const { data: owner } = await db.rpc("is_family_owner", { _family_id: familyId });
    if (!owner) return { count: 0 };
    const { count, error } = await (await s.adminDb())
      .from("timesheets")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId)
      .eq("status", "submitted");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });


export const listHouseholdTimesheets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TimesheetView[]> => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    const admin = await s.adminDb();
    const { data, error } = await admin
      .from("timesheets")
      .select("*")
      .eq("family_id", familyId)
      .neq("status", "draft")
      .order("period_start", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    // Review reads the submission snapshot, so history never depends on live events.
    return (data ?? []).map((t: any) => ({
      ...t,
      caregiver_name: t.snapshot?.caregiver_name ?? t.caregiver_name,
      time_zone: t.snapshot?.time_zone ?? "UTC",
      entries: (t.snapshot?.entries ?? []) as TimesheetEntry[],
    }));
  });

export const reviewTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      timesheet_id: z.string().uuid(),
      action: z.enum(["approve", "request_correction"]),
      note: z.string().max(1000).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    const admin = await s.adminDb();
    const { data: updated, error } = await admin
      .from("timesheets")
      .update({
        status: data.action === "approve" ? "approved" : "needs_correction",
        parent_note: data.action === "approve" ? null : data.note?.trim() || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      })
      .eq("id", data.timesheet_id)
      .eq("family_id", familyId)
      .eq("status", "submitted")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("Only submitted timesheets can be reviewed");
    const { notifyTimesheetReviewed } = await import("@/lib/timesheet-notify.server");
    await notifyTimesheetReviewed(data.timesheet_id);
    return { ok: true };
  });

/** Owner adjusts actual time/note on a submitted timesheet. Never touches the calendar event. */
export const ownerEditEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      timesheet_id: z.string().uuid(),
      entry_id: z.string().uuid(),
      start: hhmm,
      end: hhmm,
      note: z.string().max(500).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    const admin = await s.adminDb();
    const { data: sheet, error: se } = await admin.from("timesheets").select("*").eq("id", data.timesheet_id).eq("family_id", familyId).single();
    if (se || !sheet) throw new Error("Timesheet not found");
    if (sheet.status !== "submitted") throw new Error("Only submitted timesheets can be edited");
    const { data: entry, error: ee } = await admin
      .from("timesheet_entries")
      .select("id, work_date, actual_start, actual_end, note, owner_edited_at")
      .eq("id", data.entry_id)
      .eq("timesheet_id", sheet.id)
      .single();
    if (ee || !entry) throw new Error("Entry not found");
    const tz = sheet.snapshot?.time_zone ?? (await s.loadPaySettings(admin, familyId)).timeZone;
    const start = s.zonedInstant(entry.work_date, data.start, tz);
    let end = s.zonedInstant(entry.work_date, data.end, tz);
    if (end <= start) end = new Date(end.getTime() + 86_400_000); // overnight
    const patch: Record<string, unknown> = {
      actual_start: start.toISOString(),
      actual_end: end.toISOString(),
      note: data.note?.trim() || null,
      owner_edited_at: new Date().toISOString(),
      owner_edited_by: context.userId,
    };
    // Keep the caregiver-entered values the first time an Owner changes this entry.
    if (!entry.owner_edited_at) {
      patch["caregiver_actual_start"] = entry.actual_start;
      patch["caregiver_actual_end"] = entry.actual_end;
      patch["caregiver_note"] = entry.note;
    }
    const up = await admin.from("timesheet_entries").update(patch).eq("id", entry.id);
    if (up.error) throw new Error(up.error.message);
    const entries = await s.loadEntries(admin, sheet.id, tz);
    const { error } = await admin
      .from("timesheets")
      .update({
        snapshot: { ...(sheet.snapshot ?? {}), time_zone: tz, entries },
        submitted_snapshot: sheet.submitted_snapshot ?? sheet.snapshot,
        owner_edited_at: new Date().toISOString(),
        owner_edited_by: context.userId,
      })
      .eq("id", sheet.id)
      .eq("status", "submitted");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------- email notifications */

const notifySchema = z.object({
  notify_ready: z.boolean(),
  notify_reminder: z.boolean(),
  notify_owner_submit: z.boolean(),
  notify_correction: z.boolean(),
  notify_approved: z.boolean(),
});
export type TimesheetNotifySettings = z.infer<typeof notifySchema>;

export const getNotifySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TimesheetNotifySettings> => {
    const s = await import("@/lib/timesheets.server");
    const n = await import("@/lib/timesheet-notify.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    return n.loadNotifySettings(await s.adminDb(), familyId);
  });

export const saveNotifySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => notifySchema.parse(d))
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const db = context.supabase as unknown as AnyDb;
    const familyId = await s.currentFamilyId(db, context.userId);
    await s.assertOwner(db, familyId);
    const admin = await s.adminDb();
    const existing = await admin.from("timesheet_settings").select("family_id").eq("family_id", familyId).maybeSingle();
    const { DEFAULT_PAY_SETTINGS } = await import("@/lib/timesheet-periods");
    const { error } = existing.data
      ? await admin.from("timesheet_settings").update(data).eq("family_id", familyId)
      : await admin.from("timesheet_settings").insert({ family_id: familyId, ...DEFAULT_PAY_SETTINGS, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Caregiver-controlled: Timesheet emails on/off for her own record. */
export const getMyTimesheetEmailPref = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const { data } = await (await s.adminDb()).from("family_members").select("timesheet_emails_enabled").eq("id", me.memberId).single();
    return { enabled: data?.timesheet_emails_enabled !== false };
  });

export const setMyTimesheetEmailPref = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    // Only an actual ON -> OFF transition notifies owners.
    const { data: changed, error } = await admin
      .from("family_members")
      .update({ timesheet_emails_enabled: data.enabled })
      .eq("id", me.memberId)
      .eq("timesheet_emails_enabled", !data.enabled)
      .select("updated_at");
    if (error) throw new Error(error.message);
    if (!data.enabled && changed?.length) {
      const { notifyOwnersOptOut } = await import("@/lib/timesheet-notify.server");
      await notifyOwnersOptOut(me.familyId, me.memberId, changed[0].updated_at ?? new Date().toISOString());
    }
    return { enabled: data.enabled };
  });

/* ------------------------------------------------- owner-managed time cards */

async function ownerCtx(context: { supabase: unknown; userId: string }) {
  const s = await import("@/lib/timesheets.server");
  const db = context.supabase as unknown as AnyDb;
  const familyId = await s.currentFamilyId(db, context.userId);
  await s.assertOwner(db, familyId);
  return { s, familyId, admin: await s.adminDb() };
}

/** Owner-managed draft for a no-login caregiver; refuses anything else. */
async function managedEditableSheet(
  s: typeof import("@/lib/timesheets.server"),
  admin: AnyDb,
  familyId: string,
  timesheetId: string,
) {
  const { data, error } = await admin.from("timesheets").select("*").eq("id", timesheetId).eq("family_id", familyId).maybeSingle();
  if (error || !data) throw new Error("Timesheet not found");
  await s.ownerManagedCaregiver(admin, familyId, data.family_member_id);
  if (data.status !== "draft" && data.status !== "needs_correction") throw new Error("This time card is already finalized");
  return data as any;
}

/** Timesheet-enabled, active caregivers without sign-in access. */
export const listOwnerManagedCaregivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ member_id: string; name: string }[]> => {
    const { familyId, admin } = await ownerCtx(context);
    const [m, fu] = await Promise.all([
      admin
        .from("family_members")
        .select("id, name, sort_order")
        .eq("family_id", familyId)
        .eq("role", "caregiver")
        .eq("active", true)
        .eq("timesheets_enabled", true)
        .is("removed_at", null)
        .order("sort_order", { ascending: true }),
      admin.from("family_users").select("family_member_id").eq("family_id", familyId).not("family_member_id", "is", null),
    ]);
    if (m.error) throw new Error(m.error.message);
    if (fu.error) throw new Error(fu.error.message);
    const linked = new Set((fu.data ?? []).map((r: any) => r.family_member_id as string));
    return (m.data ?? []).filter((r: any) => !linked.has(r.id)).map((r: any) => ({ member_id: r.id, name: r.name }));
  });

export const getOwnerManagedTimesheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ member_id: z.string().uuid(), offset: z.number().int().min(-60).max(0) }).parse(d))
  .handler(async ({ data, context }): Promise<TimesheetView & { offset: number }> => {
    const { s, familyId, admin } = await ownerCtx(context);
    const member = await s.ownerManagedCaregiver(admin, familyId, data.member_id);
    if (!member.active || member.removed_at) throw new Error("Caregiver not found");
    const { sheet, timeZone } = await s.ensureTimesheet(admin, familyId, data.member_id, data.offset);
    const fresh = (await admin.from("timesheets").select("*").eq("id", sheet.id).single()).data;
    const finalized = fresh.status === "approved" || fresh.status === "submitted";
    return {
      ...fresh,
      offset: data.offset,
      time_zone: finalized ? fresh.snapshot?.time_zone ?? timeZone : timeZone,
      entries: finalized && fresh.snapshot?.entries ? fresh.snapshot.entries : await s.loadEntries(admin, sheet.id, timeZone),
    };
  });

export const ownerSaveManagedEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      timesheet_id: z.string().uuid(),
      entry_id: z.string().uuid().nullable(),
      work_date: dateKey,
      start: hhmm,
      end: hhmm,
      note: z.string().max(500).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { s, familyId, admin } = await ownerCtx(context);
    const sheet = await managedEditableSheet(s, admin, familyId, data.timesheet_id);
    if (data.work_date < sheet.period_start || data.work_date > sheet.period_end) throw new Error("Pick a date inside this pay period");
    const { timeZone } = await s.loadPaySettings(admin, familyId);
    const start = s.zonedInstant(data.work_date, data.start, timeZone);
    let end = s.zonedInstant(data.work_date, data.end, timeZone);
    if (end <= start) end = new Date(end.getTime() + 86_400_000); // overnight
    const note = data.note?.trim() || null;
    const now = new Date().toISOString();
    if (data.entry_id) {
      const { error } = await admin
        .from("timesheet_entries")
        .update({ actual_start: start.toISOString(), actual_end: end.toISOString(), note, owner_edited_at: now, owner_edited_by: context.userId })
        .eq("id", data.entry_id)
        .eq("timesheet_id", sheet.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("timesheet_entries").insert({
        timesheet_id: sheet.id, family_id: familyId, work_date: data.work_date,
        actual_start: start.toISOString(), actual_end: end.toISOString(), is_manual: true, note,
        owner_edited_at: now, owner_edited_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const ownerDeleteManagedEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ timesheet_id: z.string().uuid(), entry_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { s, familyId, admin } = await ownerCtx(context);
    const sheet = await managedEditableSheet(s, admin, familyId, data.timesheet_id);
    const { error } = await admin
      .from("timesheet_entries").delete().eq("id", data.entry_id).eq("timesheet_id", sheet.id).eq("is_manual", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Owner finalizes (approves) an owner-managed time card. No caregiver submission, no emails. */
export const ownerFinalizeManaged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ timesheet_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { s, familyId, admin } = await ownerCtx(context);
    const sheet = await managedEditableSheet(s, admin, familyId, data.timesheet_id);
    const { timeZone } = await s.loadPaySettings(admin, familyId);
    const entries = await s.loadEntries(admin, sheet.id, timeZone);
    const now = new Date().toISOString();
    const { error } = await admin
      .from("timesheets")
      .update({
        status: "approved",
        owner_managed: true,
        reviewed_at: now,
        reviewed_by: context.userId,
        snapshot: { time_zone: timeZone, caregiver_name: sheet.caregiver_name, entries, owner_managed: true },
      })
      .eq("id", sheet.id)
      .in("status", ["draft", "needs_correction"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
