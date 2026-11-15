import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientInput, shiftInput } from "./independent-caregiver";
import { z } from "zod";

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
    const [workspace, clients, shifts] = await Promise.all([
      context.supabase.from("caregiver_workspaces").select("user_id,timezone,onboarding_finished_at").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("caregiver_clients").select("id,name,email,color,archived").eq("user_id", context.userId).order("name"),
      context.supabase.from("caregiver_work_shifts").select("*").eq("user_id", context.userId).is("deleted_at", null).lt("start_at", data.to).gt("end_at", data.from).order("start_at"),
    ]);
    for (const result of [workspace, clients, shifts]) if (result.error) throw new Error(result.error.message);
    if (!workspace.data) throw new Error("Set up your caregiver account first");
    return { workspace: workspace.data, clients: clients.data ?? [], shifts: shifts.data ?? [] };
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
    const { id, version, ...fields } = data;
    const values = { ...fields, notes: fields.notes ?? null };
    const { data: client, error: clientError } = await context.supabase.from("caregiver_clients").select("archived").eq("id", data.client_id).eq("user_id", context.userId).single();
    if (clientError || !client) throw new Error("Choose an owned family contact");
    if (client.archived) {
      const { data: prior, error: priorError } = id ? await context.supabase.from("caregiver_work_shifts").select("client_id").eq("id", id).eq("user_id", context.userId).single() : { data: null, error: null };
      if (priorError || prior?.client_id !== data.client_id) throw new Error("Choose an active family contact");
    }
    if (id && !version) throw new Error("Reload the shift before editing");
    const result = id && version
      ? await context.supabase.from("caregiver_work_shifts").update(values).eq("id", id).eq("user_id", context.userId).eq("version", version).is("deleted_at", null).select("id").single()
      : await context.supabase.from("caregiver_work_shifts").insert({ ...values, user_id: context.userId }).select("id").single();
    if (result.error) throw new Error("The shift could not be saved. Reload it if another edit changed it.");
    return result.data;
  });
export const deleteCaregiverShift = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), version: z.string().uuid() })).handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("caregiver_work_shifts").update({ deleted_at: new Date().toISOString() }).eq("id", data.id).eq("version", data.version).eq("user_id", context.userId).is("deleted_at", null).select("id").single();
    if (error) throw new Error("Reload the shift before deleting it");
    return { ok: true };
  });
/** One family's shifts and actuals for a bounded week; RLS plus explicit owner filters keep families isolated. */
export const getCaregiverTimesheet = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ client_id: z.string().uuid(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }))
  .handler(async ({ data, context }) => {
    const span = Date.parse(data.to) - Date.parse(data.from);
    if (span <= 0 || span > 8 * 86400000) throw new Error("Choose one week");
    const [client, shifts, profile] = await Promise.all([
      context.supabase.from("caregiver_clients").select("id,name,email,color,archived").eq("id", data.client_id).eq("user_id", context.userId).single(),
      context.supabase.from("caregiver_work_shifts").select("*").eq("user_id", context.userId).eq("client_id", data.client_id).gte("start_at", data.from).lt("start_at", data.to).order("start_at"),
      context.supabase.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    ]);
    if (client.error || !client.data) throw new Error("Choose one of your family contacts");
    if (shifts.error) throw new Error(shifts.error.message);
    const ids = (shifts.data ?? []).map(s => s.id);
    const actuals = ids.length ? await context.supabase.from("caregiver_shift_actuals").select("shift_id,actual_start,actual_end,confirmed,note").eq("user_id", context.userId).in("shift_id", ids) : { data: [], error: null };
    if (actuals.error) throw new Error(actuals.error.message);
    const email = typeof context.claims?.email === "string" ? context.claims.email : "";
    return { client: client.data, shifts: shifts.data ?? [], actuals: actuals.data ?? [], caregiverName: profile.data?.display_name || email || "Caregiver" };
  });

export const saveCaregiverActual = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ shift_id: z.string().uuid(), actual_start: z.string().datetime({ offset: true }), actual_end: z.string().datetime({ offset: true }),
    confirmed: z.boolean(), note: z.string().max(2000).nullable().optional() }).refine(a => Date.parse(a.actual_end) > Date.parse(a.actual_start), "End time must be after start time"))
  .handler(async ({ data, context }) => {
    const { data: shift, error: shiftError } = await context.supabase.from("caregiver_work_shifts").select("id,deleted_at").eq("id", data.shift_id).eq("user_id", context.userId).single();
    if (shiftError || !shift) throw new Error("Choose one of your shifts");
    if (shift.deleted_at) throw new Error("This shift was removed from your calendar and can no longer be edited");
    const { error } = await context.supabase.from("caregiver_shift_actuals").upsert({ ...data, note: data.note || null, user_id: context.userId }, { onConflict: "shift_id" });
    if (error) throw new Error("Could not save these hours. Shifts can be at most 48 hours long.");
    return { ok: true };
  });
