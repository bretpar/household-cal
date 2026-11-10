import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadFamilyBundle, type Db } from "@/lib/calendar-ops";
import { draftSchema, monthSchema, templateSchema, monthDates, type Assignment, type ScheduleDraft, type ScheduleTemplate } from "@/lib/schedule-builder";
import type { supabase } from "@/integrations/supabase/client";
type Client = typeof supabase;
const scope = z.object({ familyId: z.uuid(), month: monthSchema });

async function owner(db: Client, userId: string, familyId: string) {
  const { data, error } = await db.from("family_users").select("role").eq("family_id", familyId).eq("user_id", userId).single();
  if (error || data?.role !== "owner") throw new Error("Only a current household Owner can use schedule drafts.");
}
async function validateAssignments(db: Client, familyId: string, assignments: Assignment[]) {
  const ids = [...new Set(assignments.flatMap(a => a.kind === "caregiver" ? [a.family_member_id] : []))];
  if (!ids.length) return;
  const { data, error } = await db.from("family_members").select("id").eq("family_id", familyId).eq("role", "caregiver").eq("active", true).is("removed_at", null).in("id", ids);
  if (error || data?.length !== ids.length) throw new Error("Choose a current caregiver from this household.");
}
export const loadScheduleWorkspace = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator(data => scope.parse(data)).handler(async ({ data, context }) => {
    const db = context.supabase; await owner(db, context.userId, data.familyId);
    const dates = monthDates(data.month);
    const [bundle, family, draft, templates, lineage] = await Promise.all([
      loadFamilyBundle(db as unknown as Db, context.userId, undefined, { from: `${data.month}-01`, to: dates.at(-1) ?? `${data.month}-01` }),
      db.from("families").select("timezone").eq("id", data.familyId).single().throwOnError(),
      db.from("babysitter_schedule_drafts").select("*").eq("family_id", data.familyId).eq("month", `${data.month}-01`).maybeSingle().throwOnError(),
      db.from("babysitter_schedule_templates").select("*").eq("family_id", data.familyId).order("name").throwOnError(),
      db.from("events").select("id,split_from_event_id,split_from_date").eq("family_id", data.familyId).not("split_from_event_id", "is", null).throwOnError(),
    ]);
    if (bundle.family?.id !== data.familyId || !family.data) throw new Error("Household changed. Reopen the schedule builder.");
    return { bundle, timeZone: family.data.timezone, draft: draft.data ? { revision: draft.data.revision, content: draftSchema.parse(draft.data.content) } : null,
      templates: (templates.data ?? []).map(t => ({ id: t.id, name: t.name, revision: t.revision, content: templateSchema.parse(t.content) })),
      lineage: Object.fromEntries((lineage.data ?? []).map(e => [e.id, { split_from_event_id: e.split_from_event_id, split_from_date: e.split_from_date }])),
    };
  });
export const saveScheduleDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(data => scope.extend({ revision: z.number().int().nonnegative(), content: draftSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase; await owner(db, context.userId, data.familyId);
    if (data.content.shifts.some(s => !s.date.startsWith(`${data.month}-`))) throw new Error("Every proposal must be inside the selected month.");
    await validateAssignments(db, data.familyId, data.content.shifts.map(s => s.assignment));
    const content = JSON.parse(JSON.stringify(data.content)) as { shifts: ScheduleDraft["shifts"] };
    const result = data.revision === 0
      ? await db.from("babysitter_schedule_drafts").insert({ family_id: data.familyId, month: `${data.month}-01`, content, revision: 1 }).select("revision").single()
      : await db.from("babysitter_schedule_drafts").update({ content, revision: data.revision + 1 }).eq("family_id", data.familyId).eq("month", `${data.month}-01`).eq("revision", data.revision).select("revision").maybeSingle();
    if (result.error?.code === "23505" || (!result.error && !result.data)) return { conflict: true as const };
    if (result.error) throw new Error("Draft could not be saved. Your local changes are still here.");
    return { conflict: false as const, revision: result.data?.revision ?? data.revision };
  });
export const saveScheduleTemplate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(data => z.object({ familyId: z.uuid(), name: z.string().trim().min(1).max(80), content: templateSchema }).parse(data))
  .handler(async ({ data, context }) => {
    await owner(context.supabase, context.userId, data.familyId);
    await validateAssignments(context.supabase, data.familyId, [data.content.assignment]);
    const content = JSON.parse(JSON.stringify(data.content)) as ScheduleTemplate;
    const { data: row, error } = await context.supabase.from("babysitter_schedule_templates").insert({ family_id: data.familyId, name: data.name, content }).select("id").single();
    if (error || !row) throw new Error("Template could not be saved.");
    return { id: row.id };
  });