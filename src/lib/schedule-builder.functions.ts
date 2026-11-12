import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadFamilyBundle, type Db } from "@/lib/calendar-ops";
import { type ReferencedEvent, draftSchema, monthSchema, templateSchema, monthDates, type Assignment, type ScheduleDraft, type ScheduleTemplate } from "@/lib/schedule-builder";
import { importRange, sourceHealth, visibilityHealth, type CoverageSettings, type ParentCalendar } from "@/lib/smart-coverage";
import type { supabase } from "@/integrations/supabase/client";
type Client = typeof supabase;
const scope = z.object({ familyId: z.uuid(), month: monthSchema });

async function owner(db: Client, userId: string, familyId: string) {
  const { data, error } = await db.from("family_users").select("role").eq("family_id", familyId).eq("user_id", userId).single();
  if (error || (data?.role !== "owner" && data?.role !== "editor")) throw new Error("Only a household Owner or Editor can use schedule drafts.");
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
      db.from("families").select("timezone,default_babysitter_member_id").eq("id", data.familyId).single().throwOnError(),
      db.from("babysitter_schedule_drafts").select("*").eq("family_id", data.familyId).eq("month", `${data.month}-01`).maybeSingle().throwOnError(),
      db.from("babysitter_schedule_templates").select("*").eq("family_id", data.familyId).order("name").throwOnError(),
      db.from("events").select("id,split_from_event_id,split_from_date").eq("family_id", data.familyId).not("split_from_event_id", "is", null).throwOnError(),
    ]);
    if (bundle.family?.id !== data.familyId || !family.data) throw new Error("Household changed. Reopen the schedule builder.");
    // Locate every event a saved proposal references, in any month, so a missing
    // occurrence can be told apart from a deleted one. Fails closed on error.
    const savedDraft = draft.data ? draftSchema.parse(draft.data.content) : null;
    const refIds = [...new Set([...(savedDraft?.shifts ?? []), ...(savedDraft?.removals ?? [])].flatMap(s => s.existing ? [s.existing.eventId] : []))];
    const referenced: Record<string, ReferencedEvent> = {};
    if (refIds.length) {
      const { formatInTimeZone } = await import("date-fns-tz");
      const rows = await db.from("events").select("id,calendar_source_id,start_at,recurrence_rule").eq("family_id", data.familyId).in("id", refIds).throwOnError();
      for (const r of rows.data ?? []) referenced[r.id] = { onSitterCalendar: r.calendar_source_id === bundle.family?.babysitter_calendar_source_id,
        month: formatInTimeZone(new Date(r.start_at), family.data.timezone, "yyyy-MM"), recurring: !!r.recurrence_rule };
    }
    const mappings = await db.from("babysitter_schedule_publish_ops").select("draft_shift_id,event_id,kind,draft_revision")
      .eq("family_id", data.familyId).eq("draft_id", draft.data?.id ?? "00000000-0000-0000-0000-000000000000")
      .eq("status", "applied").order("draft_revision", { ascending: false }).throwOnError();
    const publishedEvents: Record<string, string> = {};
    const appliedRemovals: string[] = [];
    for (const row of mappings.data ?? []) {
      if (row.kind === "exclude") appliedRemovals.push(row.draft_shift_id);
      else if (row.event_id && !publishedEvents[row.draft_shift_id]) publishedEvents[row.draft_shift_id] = row.event_id;
    }
    const coverage = await loadCoverageSettings(db, data.familyId, bundle.family?.babysitter_calendar_source_id ?? null);
    await checkWorkVisibility(data.familyId, data.month, coverage.settings, bundle);
    return { publishedEvents, appliedRemovals, coverage, regularCaregiverId: family.data.default_babysitter_member_id ?? null, referenced, checkedEventIds: refIds, bundle, timeZone: family.data.timezone, draft: draft.data ? { revision: draft.data.revision, content: draftSchema.parse(draft.data.content) } : null,
      templates: (templates.data ?? []).map(t => ({ id: t.id, name: t.name, revision: t.revision, content: templateSchema.parse(t.content) })),
      lineage: Object.fromEntries((lineage.data ?? []).map(e => [e.id, { split_from_event_id: e.split_from_event_id, split_from_date: e.split_from_date }])),
    };
  });
export const saveScheduleDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(data => scope.extend({ revision: z.number().int().nonnegative(), content: draftSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase; await owner(db, context.userId, data.familyId);
    if ([...data.content.shifts, ...(data.content.removals ?? [])].some(s => !s.date.startsWith(`${data.month}-`))) throw new Error("Every proposal must be inside the selected month.");
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
/**
 * Owner already verified. Compares every work-calendar event that overlaps the
 * month (same window as the bundle) with what the bundle delivered to this
 * Owner; any hidden/inaccessible calendar or event marks the parent "hidden".
 * Fails closed: a lookup error also marks it hidden.
 */
async function checkWorkVisibility(familyId: string, month: string, settings: CoverageSettings, bundle: Awaited<ReturnType<typeof loadFamilyBundle>>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // A selected calendar the Owner can't read looks "unavailable"; if it still
  // exists and is active it is hidden, not removed. Fails closed to hidden.
  for (const p of settings.parents.filter(p => p.sourceId && p.health === "unavailable")) {
    const { data, error } = await supabaseAdmin.from("calendar_sources").select("name,active").eq("family_id", familyId).eq("id", p.sourceId!).maybeSingle();
    if (error || data?.active) { p.health = "hidden"; p.sourceName = data?.name ?? p.sourceName; }
  }
  const picked = settings.parents.filter(p => p.sourceId && p.health !== "missing" && p.health !== "unavailable" && p.health !== "hidden");
  if (!picked.length) return;
  const dates = monthDates(month);
  const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const fromIso = `${shift(dates[0]!, -1)}T00:00:00Z`, toIso = `${shift(dates.at(-1)!, 2)}T00:00:00Z`;
  const delivered = new Set(bundle.events.map(e => e.id));
  const sourceIds = new Set(bundle.sources.map(s => s.id));
  for (const p of picked) {
    const { data, error } = await supabaseAdmin.from("events").select("id").eq("family_id", familyId).eq("calendar_source_id", p.sourceId!)
      .or(`and(start_at.lt.${toIso},end_at.gt.${fromIso}),recurrence_rule.not.is.null`);
    p.health = error ? "hidden" : visibilityHealth(p.health, sourceIds.has(p.sourceId!), (data ?? []).map(r => r.id), delivered);
  }
}
/** Work-calendar choices and their current health; read-only for the calendars themselves. */
async function loadCoverageSettings(db: Client, familyId: string, sitterSourceId: string | null) {
  const [settings, sources] = await Promise.all([
    db.from("babysitter_coverage_settings").select("*").eq("family_id", familyId).maybeSingle().throwOnError(),
    db.from("calendar_sources").select("id,name,active,provider,sync_error,sync_paused_at,sync_status,last_synced_at").eq("family_id", familyId).order("sort_order").throwOnError(),
  ]);
  const rows = (sources.data ?? []).filter(r => r.id !== sitterSourceId);
  const s = settings.data;
  const parent = (label: string, id: string | null): ParentCalendar => {
    const row = id ? rows.find(r => r.id === id) : undefined;
    return { label, sourceId: id, sourceName: row?.name ?? null, health: !id ? "missing" : sourceHealth(row), range: id ? importRange(row) : null };
  };
  return {
    settings: { parents: [parent(s?.parent_one_label ?? "Dad", s?.parent_one_source_id ?? null), parent(s?.parent_two_label ?? "Mom", s?.parent_two_source_id ?? null)] as [ParentCalendar, ParentCalendar],
      bufferBefore: s?.buffer_before_minutes ?? 0, bufferAfter: s?.buffer_after_minutes ?? 0 } satisfies CoverageSettings,
    sources: rows.filter(r => r.active).map(r => ({ id: r.id, name: r.name, provider: r.provider })),
  };
}
const coverageInput = z.object({ familyId: z.uuid(),
  parents: z.array(z.object({ label: z.string().trim().min(1).max(40), sourceId: z.uuid().nullable() })).length(2),
  bufferBefore: z.number().int().min(0).max(240), bufferAfter: z.number().int().min(0).max(240) });
export const saveCoverageSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(data => coverageInput.parse(data)).handler(async ({ data, context }) => {
    const db = context.supabase; await owner(db, context.userId, data.familyId);
    const ids = [...new Set(data.parents.flatMap(p => p.sourceId ? [p.sourceId] : []))];
    if (ids.length) {
      const fam = await db.from("families").select("babysitter_calendar_source_id").eq("id", data.familyId).single().throwOnError();
      const { data: rows, error } = await db.from("calendar_sources").select("id").eq("family_id", data.familyId).eq("active", true).in("id", ids);
      if (error || rows?.length !== ids.length || ids.includes(fam.data?.babysitter_calendar_source_id ?? "")) throw new Error("Choose a current household calendar other than the Babysitter calendar.");
    }
    const [one, two] = data.parents as [typeof data.parents[0], typeof data.parents[0]];
    const { error } = await db.from("babysitter_coverage_settings").upsert({ family_id: data.familyId,
      parent_one_label: one.label, parent_one_source_id: one.sourceId,
      parent_two_label: two.label, parent_two_source_id: two.sourceId,
      buffer_before_minutes: data.bufferBefore, buffer_after_minutes: data.bufferAfter, updated_at: new Date().toISOString() });
    if (error) throw new Error("Coverage settings could not be saved.");
    return { ok: true };
  });
