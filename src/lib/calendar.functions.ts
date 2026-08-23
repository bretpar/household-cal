import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  CalendarEvent,
  CalendarSource,
  DisplayMode,
  EventType,
  Family,
  FamilyActivity,
  FamilyMember,
  FamilyRole,
  MemberColor,
} from "@/lib/family-data";

export interface EventInput {
  calendar_source_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  event_type: EventType;
  recurrence_rule: string | null;
  member_ids: string[];
}

export type RecurrenceScope = "this" | "future" | "series";

export interface FamilyBundle {
  family: Family | null;
  members: FamilyMember[];
  sources: CalendarSource[];
  events: CalendarEvent[];
  activities: FamilyActivity[];
}

/** yyyy-MM-dd string maths without timezone surprises. */
function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function asEventInput(data: unknown): EventInput {
  const raw = data as Record<string, unknown>;
  if (typeof raw?.["title"] !== "string" || !raw["title"].trim()) throw new Error("Title required");
  if (!Array.isArray(raw["member_ids"])) throw new Error("member_ids required");
  return raw as unknown as EventInput;
}

/**
 * Every signed-in user must belong to at least one household. The first user of a
 * fresh deployment claims an unclaimed seeded household; everyone else gets their
 * own empty household. No email address or household name is special-cased.
 */
export const ensureFamilyMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    await supabaseAdmin.from("profiles").upsert({ id: userId }, { onConflict: "id" });

    const { data: existing } = await supabaseAdmin
      .from("family_users")
      .select("family_id")
      .eq("user_id", userId)
      .limit(1);
    if (existing && existing.length > 0) return { family_id: existing[0]!.family_id };

    // claim an unclaimed household (seeded demo data) if one exists
    const { data: unclaimed } = await supabaseAdmin
      .from("families")
      .select("id")
      .is("created_by", null)
      .order("created_at", { ascending: true })
      .limit(1);

    let familyId = unclaimed?.[0]?.id ?? null;
    if (familyId) {
      await supabaseAdmin.from("families").update({ created_by: userId }).eq("id", familyId);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("families")
        .insert({ name: "My Family", created_by: userId })
        .select("id")
        .single();
      if (error) throw error;
      familyId = created.id;
      await supabaseAdmin.from("calendar_sources").insert([
        { family_id: familyId, name: "Family", display_mode: "events", sort_order: 0 },
        {
          family_id: familyId,
          name: "Caregiver coverage",
          display_mode: "coverage_background",
          sort_order: 1,
        },
      ]);
    }

    await supabaseAdmin
      .from("family_users")
      .upsert(
        { family_id: familyId, user_id: userId, role: "owner" },
        { onConflict: "family_id,user_id" },
      );

    return { family_id: familyId };
  });

/** Reads everything the calendar UI needs for the household the user is authorized for. */
export const getFamilyBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FamilyBundle> => {
    const supabase = context.supabase;

    const { data: memberships, error: mErr } = await supabase
      .from("family_users")
      .select("family_id, role, families(id, name)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (mErr) throw mErr;

    const membership = memberships?.[0];
    if (!membership) {
      return { family: null, members: [], sources: [], events: [], activities: [] };
    }

    const familyId = membership.family_id;
    const family: Family = {
      id: familyId,
      name: (membership.families as { name?: string } | null)?.name ?? "Family",
      role: membership.role as FamilyRole,
    };

    const [membersRes, sourcesRes, eventsRes, activitiesRes] = await Promise.all([
      supabase
        .from("family_members")
        .select("*")
        .eq("family_id", familyId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("calendar_sources")
        .select("*")
        .eq("family_id", familyId)
        .order("sort_order", { ascending: true }),
      supabase.from("events").select("*, event_members(family_member_id)").eq("family_id", familyId),
      supabase
        .from("activities")
        .select("*, activity_members(family_member_id)")
        .eq("family_id", familyId)
        .order("created_at", { ascending: true }),
    ]);

    for (const res of [membersRes, sourcesRes, eventsRes, activitiesRes]) {
      if (res.error) throw res.error;
    }

    const sources: CalendarSource[] = (sourcesRes.data ?? []).map((s) => ({
      id: s.id,
      family_id: s.family_id,
      name: s.name,
      provider: s.provider,
      external_calendar_id: s.external_calendar_id,
      display_mode: s.display_mode as DisplayMode,
      active: s.active,
    }));
    const displayModeOf = new Map(sources.map((s) => [s.id, s.display_mode]));

    const members: FamilyMember[] = (membersRes.data ?? []).map((m) => ({
      id: m.id,
      family_id: m.family_id,
      name: m.name,
      initial: m.initial,
      color: m.color as MemberColor,
      role: m.role,
      access: m.access,
      active: m.active,
      sort_order: m.sort_order,
    }));

    const events: CalendarEvent[] = (eventsRes.data ?? []).map((e) => ({
      id: e.id,
      family_id: e.family_id,
      calendar_source_id: e.calendar_source_id,
      display_mode:
        (e.calendar_source_id ? displayModeOf.get(e.calendar_source_id) : "events") ?? "events",
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      location: e.location,
      notes: e.notes,
      event_type: e.event_type,
      recurrence_rule: e.recurrence_rule,
      recurrence_until: e.recurrence_until,
      excluded_dates: e.excluded_dates ?? [],
      external_event_id: e.external_event_id,
      external_recurring_event_id: e.external_recurring_event_id,
      member_ids: (e.event_members ?? []).map(
        (link: { family_member_id: string }) => link.family_member_id,
      ),
    }));

    const activities: FamilyActivity[] = (activitiesRes.data ?? []).map((a) => ({
      id: a.id,
      family_id: a.family_id,
      name: a.name,
      event_type: a.event_type,
      location: a.location,
      schedule_label: a.schedule_label,
      recurrence_rule: a.recurrence_rule,
      active: a.active,
      member_ids: (a.activity_members ?? []).map(
        (link: { family_member_id: string }) => link.family_member_id,
      ),
    }));

    return { family, members, sources, events, activities };
  });

async function insertEvent(
  supabase: { from: (t: string) => any },
  familyId: string,
  input: EventInput,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const { data, error } = await supabase
    .from("events")
    .insert({
      family_id: familyId,
      calendar_source_id: input.calendar_source_id,
      title: input.title.trim(),
      start_at: input.start_at,
      end_at: input.end_at,
      all_day: input.all_day,
      location: input.location,
      notes: input.notes,
      event_type: input.event_type,
      recurrence_rule: input.recurrence_rule,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (input.member_ids.length > 0) {
    const { error: linkError } = await supabase
      .from("event_members")
      .insert(input.member_ids.map((id) => ({ event_id: data.id, family_member_id: id })));
    if (linkError) throw linkError;
  }
  return data.id as string;
}

/** Resolves the household the user may write to, defaulting to their first membership. */
async function resolveWritableFamily(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("family_users")
    .select("family_id, role")
    .eq("user_id", userId)
    .in("role", ["owner", "editor"])
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const familyId = data?.[0]?.family_id;
  if (!familyId) throw new Error("You do not have permission to change this calendar");
  return familyId;
}

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => asEventInput(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as { from: (t: string) => any };
    const familyId = await resolveWritableFamily(supabase, context.userId);
    let sourceId = data.calendar_source_id;
    if (!sourceId) {
      const { data: sources } = await supabase
        .from("calendar_sources")
        .select("id")
        .eq("family_id", familyId)
        .eq("display_mode", "events")
        .order("sort_order", { ascending: true })
        .limit(1);
      sourceId = sources?.[0]?.id ?? null;
    }
    const id = await insertEvent(supabase, familyId, { ...data, calendar_source_id: sourceId });
    return { id };
  });

export const updateEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      event_id: string;
      occurrence_day: string;
      scope: RecurrenceScope;
      input: unknown;
    }) => ({ ...data, input: asEventInput(data.input) }),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as { from: (t: string) => any };
    const { data: existing, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", data.event_id)
      .single();
    if (error) throw error;

    const input = data.input;
    const familyId = existing.family_id as string;

    const replaceMembers = async () => {
      await supabase.from("event_members").delete().eq("event_id", data.event_id);
      if (input.member_ids.length > 0) {
        const { error: linkError } = await supabase
          .from("event_members")
          .insert(
            input.member_ids.map((id) => ({ event_id: data.event_id, family_member_id: id })),
          );
        if (linkError) throw linkError;
      }
    };

    if (!existing.recurrence_rule || data.scope === "series") {
      const { error: updateError } = await supabase
        .from("events")
        .update({
          title: input.title.trim(),
          start_at: input.start_at,
          end_at: input.end_at,
          all_day: input.all_day,
          location: input.location,
          notes: input.notes,
          event_type: input.event_type,
          recurrence_rule: input.recurrence_rule,
          calendar_source_id: input.calendar_source_id ?? existing.calendar_source_id,
        })
        .eq("id", data.event_id);
      if (updateError) throw updateError;
      await replaceMembers();
      return { ok: true };
    }

    if (data.scope === "this") {
      const excluded = [...(existing.excluded_dates ?? []), data.occurrence_day];
      const { error: exError } = await supabase
        .from("events")
        .update({ excluded_dates: excluded })
        .eq("id", data.event_id);
      if (exError) throw exError;
      await insertEvent(
        supabase,
        familyId,
        {
          ...input,
          recurrence_rule: null,
          calendar_source_id: input.calendar_source_id ?? existing.calendar_source_id,
        },
        { external_recurring_event_id: existing.external_event_id ?? null },
      );
      return { ok: true };
    }

    // "future": end the existing series the day before, start a new series here
    const { error: untilError } = await supabase
      .from("events")
      .update({ recurrence_until: shiftDayKey(data.occurrence_day, -1) })
      .eq("id", data.event_id);
    if (untilError) throw untilError;
    await insertEvent(supabase, familyId, {
      ...input,
      calendar_source_id: input.calendar_source_id ?? existing.calendar_source_id,
    });
    return { ok: true };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) => data,
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as { from: (t: string) => any };
    const { data: existing, error } = await supabase
      .from("events")
      .select("id, recurrence_rule, excluded_dates")
      .eq("id", data.event_id)
      .single();
    if (error) throw error;

    if (!existing.recurrence_rule || data.scope === "series") {
      const { error: delError } = await supabase.from("events").delete().eq("id", data.event_id);
      if (delError) throw delError;
      return { ok: true };
    }

    if (data.scope === "this") {
      const excluded = [...(existing.excluded_dates ?? []), data.occurrence_day];
      const { error: exError } = await supabase
        .from("events")
        .update({ excluded_dates: excluded })
        .eq("id", data.event_id);
      if (exError) throw exError;
      return { ok: true };
    }

    const { error: untilError } = await supabase
      .from("events")
      .update({ recurrence_until: shiftDayKey(data.occurrence_day, -1) })
      .eq("id", data.event_id);
    if (untilError) throw untilError;
    return { ok: true };
  });
