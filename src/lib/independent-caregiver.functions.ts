import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientInput, shiftInput } from "./independent-caregiver";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
type SeriesArgs = Database["public"]["Functions"]["mutate_caregiver_series"]["Args"];

export const createCaregiverWorkspace = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ timezone: z.string().min(1).max(100) }))
  .handler(async ({ data, context }) => {
    try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { throw new Error("Choose a valid time zone"); }
    const { data: membership, error: accessError } = await context.supabase.from("family_users").select("id").eq("user_id", context.userId).limit(1);
    if (accessError) throw new Error(accessError.message);
    if (membership?.length) throw new Error("Existing household accounts keep their current setup");
    const { error } = await context.supabase.from("caregiver_workspaces").upsert({ user_id: context.userId, timezone: data.timezone, onboarding_finished_at: null }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, userId: context.userId };
  });

export const finishCaregiverOnboarding = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("caregiver_workspaces")
      .update({ onboarding_finished_at: new Date().toISOString() }).eq("user_id", context.userId).select("user_id").single();
    if (error) throw new Error("Could not finish caregiver setup. Please try again.");
    return { ok: true };
  });

export const getCaregiverWorkTimezone = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("caregiver_workspaces").select("timezone").eq("user_id", context.userId).single();
    if (error || !data) throw new Error("Could not read your work time zone");
    return data.timezone;
  });

export const getCaregiverWorkspace = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }))
  .handler(async ({ data, context }) => {
    if (Date.parse(data.to) <= Date.parse(data.from) || Date.parse(data.to) - Date.parse(data.from) > 100 * 86400000) throw new Error("Choose a date range of at most 100 days");
    const { ensureCaregiverOccurrences } = await import("./caregiver-recurrence.server");
    await ensureCaregiverOccurrences(context.userId, data.from, data.to);
    const [workspace, clients, shifts] = await Promise.all([
      context.supabase.from("caregiver_workspaces").select("user_id,timezone,onboarding_finished_at,timesheet_frequency,timesheet_anchor").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("caregiver_clients").select("id,name,email,color,archived").eq("user_id", context.userId).order("name"),
      context.supabase.from("caregiver_work_shifts").select("*").eq("user_id", context.userId).is("deleted_at", null).lt("start_at", data.to).gt("end_at", data.from).order("start_at"),
    ]);
    for (const result of [workspace, clients, shifts]) if (result.error) throw new Error(result.error.message);
    if (!workspace.data) throw new Error("Set up your caregiver account first");
    const series = await context.supabase.from("caregiver_shift_series").select("id,weekdays,until_date").eq("user_id", context.userId);
    if (series.error) throw new Error(series.error.message);
    return { workspace: workspace.data, clients: clients.data ?? [], shifts: shifts.data ?? [], series: series.data ?? [] };
  });

export const saveCaregiverClient = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(clientInput).handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const values = { ...fields, email: fields.email || null };
    const result = id
      ? await context.supabase.from("caregiver_clients").update(values).eq("id", id).eq("user_id", context.userId).select("id").single()
      : await context.supabase.from("caregiver_clients").insert({ ...values, user_id: context.userId }).select("id").single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
export const archiveCaregiverClient = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), archived: z.boolean() })).handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("caregiver_clients").update({ archived: data.archived }).eq("id", data.id).eq("user_id", context.userId).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const saveCaregiverShift = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(shiftInput).handler(async ({ data, context }) => {
    const { id, version, weekdays, until_date, scope, ...fields } = data;
    const values = { ...fields, notes: fields.notes ?? null };
    const { data: client, error: clientError } = await context.supabase.from("caregiver_clients").select("archived").eq("id", data.client_id).eq("user_id", context.userId).single();
    if (clientError || !client) throw new Error("Choose an owned family contact");
    if (client.archived) {
      const { data: prior, error: priorError } = id ? await context.supabase.from("caregiver_work_shifts").select("client_id").eq("id", id).eq("user_id", context.userId).single() : { data: null, error: null };
      if (priorError || prior?.client_id !== data.client_id) throw new Error("Choose an active family contact");
    }
    if (id && !version) throw new Error("Reload the shift before editing");
    const prior = id ? await context.supabase.from("caregiver_work_shifts").select("series_id").eq("id", id).eq("user_id", context.userId).single() : null;
    if (prior?.error) throw new Error("Reload the shift before editing");
    if (weekdays?.length || prior?.data?.series_id) {
      const { data: zone, error: zoneError } = await context.supabase.from("caregiver_workspaces").select("timezone").eq("user_id", context.userId).single();
      if (zoneError || !zone) throw new Error("Work time zone unavailable");
      const { formatInTimeZone } = await import("date-fns-tz");
      if (until_date && until_date < formatInTimeZone(data.start_at, zone.timezone, "yyyy-MM-dd")) throw new Error("Repeat end cannot be before start");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const result = await supabaseAdmin.rpc("mutate_caregiver_series", { _user: context.userId, _shift: id ?? null, _version: version ?? null, _scope: scope ?? "only", _delete: false, _client: data.client_id, _start: data.start_at, _end: data.end_at, _days: weekdays ?? [], _until: until_date ?? null, _notes: data.notes ?? null } as unknown as SeriesArgs);
      if (result.error) throw new Error(result.error.message);
      return { id: result.data };
    }
    const result = id && version
      ? await context.supabase.from("caregiver_work_shifts").update(values).eq("id", id).eq("user_id", context.userId).eq("version", version).is("deleted_at", null).select("id").single()
      : await context.supabase.from("caregiver_work_shifts").insert({ ...values, user_id: context.userId }).select("id").single();
    if (result.error) throw new Error("The shift could not be saved. Reload it if another edit changed it.");
    return result.data;
  });
export const deleteCaregiverShift = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), version: z.string().uuid(), scope: z.enum(["only", "future"]).optional() })).handler(async ({ data, context }) => {
    const prior = await context.supabase.from("caregiver_work_shifts").select("*").eq("id", data.id).eq("user_id", context.userId).single();
    if (prior.error || !prior.data) throw new Error("Reload the shift before deleting");
    if (prior.data.series_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("mutate_caregiver_series", { _user: context.userId, _shift: data.id, _version: data.version, _scope: data.scope ?? "only", _delete: true, _client: prior.data.client_id, _start: prior.data.start_at, _end: prior.data.end_at, _days: [], _until: null, _notes: null } as unknown as SeriesArgs);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await context.supabase.from("caregiver_work_shifts").update({ deleted_at: new Date().toISOString() }).eq("id", data.id).eq("version", data.version).eq("user_id", context.userId).is("deleted_at", null).select("id").single();
    if (error) throw new Error("Reload the shift before deleting it");
    return { ok: true };
  });
/** One family's shifts and actuals for a bounded week; RLS plus explicit owner filters keep families isolated. */
export const getCaregiverTimesheet = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ client_id: z.string().uuid(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }))
  .handler(async ({ data, context }) => {
    const span = Date.parse(data.to) - Date.parse(data.from);
    if (span <= 0 || span > 32 * 86400000) throw new Error("Choose one timesheet period");
    const { ensureCaregiverOccurrences } = await import("./caregiver-recurrence.server");
    await ensureCaregiverOccurrences(context.userId, data.from, data.to);
    const [client, shifts, profile] = await Promise.all([
      context.supabase.from("caregiver_clients").select("id,name,email,color,archived").eq("id", data.client_id).eq("user_id", context.userId).single(),
      context.supabase.from("caregiver_work_shifts").select("*").eq("user_id", context.userId).eq("client_id", data.client_id).gte("start_at", data.from).lt("start_at", data.to).order("start_at"),
      context.supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    ]);
    if (client.error || !client.data) throw new Error("Choose one of your family contacts");
    if (shifts.error) throw new Error(shifts.error.message);
    const { data: workspace, error: zoneError } = await context.supabase.from("caregiver_workspaces").select("timezone").eq("user_id", context.userId).single();
    if (zoneError || !workspace) throw new Error("Work time zone unavailable");
    const { formatInTimeZone } = await import("date-fns-tz");
    const actuals = await context.supabase.from("caregiver_shift_actuals").select("shift_id,actual_start,actual_end,confirmed,note,work_date,client_id").eq("user_id", context.userId).eq("client_id", data.client_id).gte("work_date", formatInTimeZone(data.from, workspace.timezone, "yyyy-MM-dd")).lt("work_date", formatInTimeZone(data.to, workspace.timezone, "yyyy-MM-dd"));
    if (actuals.error) throw new Error(actuals.error.message);
    const scheduledIds = (shifts.data ?? []).map(s => s.id);
    const linked = scheduledIds.length ? await context.supabase.from("caregiver_shift_actuals").select("shift_id,actual_start,actual_end,confirmed,note,work_date,client_id").eq("user_id", context.userId).in("shift_id", scheduledIds) : { data: [], error: null };
    if (linked.error) throw new Error(linked.error.message);
    const otherFamily = new Set((linked.data ?? []).filter(a => a.confirmed && a.client_id !== data.client_id).map(a => a.shift_id));
    const email = typeof context.claims?.email === "string" ? context.claims.email : "";
    const retainedIds = (actuals.data ?? []).map(a => a.shift_id);
    const retained = retainedIds.length ? await context.supabase.from("caregiver_work_shifts").select("*").eq("user_id", context.userId).in("id", retainedIds) : { data: [], error: null };
    if (retained.error) throw new Error(retained.error.message);
    return { client: client.data, shifts: [...new Map([...(shifts.data ?? []).filter(s => !otherFamily.has(s.id)), ...(retained.data ?? [])].map(s => [s.id, s])).values()], actuals: [...new Map([...(linked.data ?? []), ...(actuals.data ?? [])].map(a => [a.shift_id, a])).values()], caregiverName: profile.data?.display_name || email || "Caregiver" };
  });

export const saveCaregiverActual = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ shift_id: z.string().uuid(), actual_start: z.string().datetime({ offset: true }), actual_end: z.string().datetime({ offset: true }),
    confirmed: z.boolean(), note: z.string().max(2000).nullable().optional() }).refine(a => Date.parse(a.actual_end) > Date.parse(a.actual_start), "End time must be after start time"))
  .handler(async ({ data, context }) => {
    const { data: shift, error: shiftError } = await context.supabase.from("caregiver_work_shifts").select("id,deleted_at").eq("id", data.shift_id).eq("user_id", context.userId).single();
    if (shiftError || !shift) throw new Error("Choose one of your shifts");
    if (!data.confirmed) {
      const { error } = await context.supabase.from("caregiver_shift_actuals").delete().eq("shift_id", data.shift_id).eq("user_id", context.userId);
      if (error) throw new Error("Could not reset these hours");
      return { ok: true };
    }
    const { error } = await context.supabase.from("caregiver_shift_actuals").upsert({ ...data, note: data.note || null, user_id: context.userId }, { onConflict: "shift_id" });
    if (error) throw new Error("Could not save these hours. Shifts can be at most 48 hours long.");
    return { ok: true };
  });

export const saveCaregiverTimesheetSchedule = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ frequency: z.enum(["weekly", "biweekly", "monthly"]), anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("caregiver_workspaces").update({ timesheet_frequency: data.frequency, timesheet_anchor: data.anchor_date }).eq("user_id", context.userId).select("user_id").single();
    if (error) throw new Error("Could not save timesheet schedule");
    return { ok: true };
  });
