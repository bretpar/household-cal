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