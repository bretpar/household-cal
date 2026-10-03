import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CalendarSource } from "@/lib/family-data";

async function assertOwner(context: any, familyId: string) {
  const { data, error } = await context.supabase.rpc("is_family_owner", { _family_id: familyId });
  if (error) throw error;
  if (!data) throw new Error("Only household owners can run this diagnostic");
}

/** Owner-only list of caregivers with a caregiver access profile. */
export const listDiagnosticCaregivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ family_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context, data.family_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await (supabaseAdmin as any)
      .from("babysitter_access_profiles")
      .select("family_user_id, family_users!inner(family_member_id, family_members(name))")
      .eq("family_id", data.family_id);
    if (res.error) throw res.error;
    return (res.data ?? []).map((r: any) => ({
      membership_id: r.family_user_id as string,
      name: (r.family_users?.family_members?.name as string) ?? "Caregiver",
    }));
  });

export interface DiagnosticEvent {
  id: string; title: string; calendar: string; calendar_source_id: string | null;
  kind: string; recurrence_rule: string | null; assignment: string | null;
  decision: string; client_note: string | null;
}

/** Read-only trace of the secure caregiver visibility decision for one date. */
export const runCaregiverDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ membership_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const fu = await admin.from("family_users").select("id, family_id, user_id, role, family_member_id, family_members(name)")
      .eq("id", data.membership_id).maybeSingle();
    if (fu.error) throw fu.error;
    if (!fu.data) throw new Error("Caregiver not found");
    const familyId = fu.data.family_id as string;
    await assertOwner(context, familyId);

    const [prof, cals, srcs] = await Promise.all([
      admin.from("babysitter_access_profiles").select("date_scope").eq("family_user_id", fu.data.id).maybeSingle(),
      admin.from("babysitter_access_calendars").select("calendar_source_id").eq("family_user_id", fu.data.id),
      admin.from("calendar_sources").select("*").eq("family_id", familyId),
    ]);
    for (const r of [prof, cals, srcs]) if (r.error) throw r.error;
    if (!prof.data) throw new Error("This person has no caregiver access");
    const scope = prof.data.date_scope as string;
    const permitted = new Set<string>((cals.data ?? []).map((c: any) => c.calendar_source_id));
    const sources: CalendarSource[] = (srcs.data ?? []).map((s: any) => ({ ...s, calendar_kind: s.calendar_kind ?? "custom" }));
    const byId = new Map(sources.map((s) => [s.id, s]));

    const trace = { date: data.date, authorized: scope !== "shift_days_only", shiftEventIds: [] as string[], decisions: {} as Record<string, string> };
    let loadError: string | null = null;
    if (scope === "shift_days_only") {
      const { loadSecureCaregiverOccurrences } = await import("@/lib/caregiver-occurrences.server");
      try { await loadSecureCaregiverOccurrences(fu.data.user_id, familyId, sources, trace); }
      catch (e) { loadError = e instanceof Error ? e.message : "Secure load failed"; }
    }

    const lo = new Date(Date.parse(`${data.date}T00:00:00Z`) - 2 * 86_400_000).toISOString();
    const hi = new Date(Date.parse(`${data.date}T00:00:00Z`) + 3 * 86_400_000).toISOString();
    const ev = await admin.from("events")
      .select("id, title, calendar_source_id, recurrence_rule, external_recurring_event_id, start_at, end_at")
      .eq("family_id", familyId)
      .or(`recurrence_rule.not.is.null,and(start_at.lte.${hi},end_at.gte.${lo})`);
    if (ev.error) throw ev.error;
    const ids = (ev.data ?? []).map((e: any) => e.id);
    const sh = ids.length
      ? await admin.from("babysitter_shifts").select("event_id, assignment, assignee_member_id, assignee_name").in("event_id", ids)
      : { data: [], error: null };
    if (sh.error) throw sh.error;
    const shiftBy = new Map((sh.data ?? []).map((s: any) => [s.event_id, s]));

    const events: DiagnosticEvent[] = (ev.data ?? []).map((e: any) => {
      const src = e.calendar_source_id ? byId.get(e.calendar_source_id) : undefined;
      const s: any = shiftBy.get(e.id);
      let decision: string;
      if (!e.calendar_source_id || !src) decision = "EXCLUDED: calendar source missing";
      else if (!permitted.has(e.calendar_source_id)) decision = "EXCLUDED: calendar not permitted";
      else if (scope !== "shift_days_only") decision = "INCLUDED (all permitted dates; row-level security)";
      else if (e.recurrence_rule) decision = trace.decisions[e.id] ?? (loadError ? `EXCLUDED: secure load failed (${loadError})` : "EXCLUDED: date not authorized");
      else if (trace.shiftEventIds.includes(e.id)) decision = "INCLUDED (own assigned shift; row-level security)";
      else decision = trace.decisions[e.id] ?? (trace.authorized
        ? "INCLUDED (one-off on a one-off shift day; row-level security)"
        : "EXCLUDED: date not authorized");
      const included = decision.startsWith("INCLUDED");
      const client_note = !included ? null
        : src?.display_mode === "coverage_background" ? "Calendar shows as background shading, not as an event card"
        : !src?.active ? "Calendar is inactive — client hides it"
        : "Could still be hidden by the caregiver's People/Category filters";
      return {
        id: e.id, title: e.title, calendar: src?.name ?? "(missing)", calendar_source_id: e.calendar_source_id,
        kind: e.recurrence_rule ? "recurring master" : e.external_recurring_event_id ? "detached/exception" : "one-time",
        recurrence_rule: e.recurrence_rule,
        assignment: s ? `${s.assignment}${s.assignee_member_id ? ` · ${s.assignee_member_id}` : ""}${s.assignee_name ? ` · ${s.assignee_name}` : ""}` : null,
        decision, client_note,
      };
    }).filter((e: DiagnosticEvent) => e.recurrence_rule === null || !e.decision.includes("not generated") || true);

    return {
      name: (fu.data.family_members?.name as string) ?? "Caregiver",
      scope, authorized: trace.authorized, load_error: loadError,
      calendars: sources.filter((s) => permitted.has(s.id)).map((s) => ({
        name: s.name, id: s.id, external_id: (s as any).external_calendar_id ?? null,
      })),
      events,
    };
  });
