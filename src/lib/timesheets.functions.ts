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
  .inputValidator((d) => z.object({ offset: z.number().int().min(-60).max(0) }).parse(d))
  .handler(async ({ data, context }): Promise<TimesheetView> => {
    const s = await import("@/lib/timesheets.server");
    const me = await s.myCaregiver(context.supabase as unknown as AnyDb, context.userId);
    const admin = await s.adminDb();
    const { sheet, timeZone } = await s.ensureTimesheet(admin, me.familyId, me.memberId, data.offset);
    const fresh = (await admin.from("timesheets").select("*").eq("id", sheet.id).single()).data;
    return { ...fresh, time_zone: timeZone, entries: await s.loadEntries(admin, sheet.id, timeZone) };
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
    return { ok: true };
  });

/* -------------------------------------------------------------------- owner */

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
    return { ok: true };
  });
