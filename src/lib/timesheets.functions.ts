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
