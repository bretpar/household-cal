import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CalendarEvent, CalendarSource } from "@/lib/family-data";

export interface CaregiverPreview {
  date_scope: "all_permitted" | "shift_days_only";
  calendars: string[];
  events: CalendarEvent[];
}

/**
 * Read-only, owner-only preview of what a linked caregiver can currently see.
 * Reuses the same secure expansion the caregiver's own calendar load uses; it
 * never changes permissions or writes anything.
 */
export const previewCaregiverAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ membership_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CaregiverPreview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const fu = await admin
      .from("family_users")
      .select("id, family_id, user_id, role")
      .eq("id", data.membership_id)
      .maybeSingle();
    if (fu.error) throw fu.error;
    if (!fu.data || fu.data.role !== "viewer") throw new Error("Caregiver not found");
    const familyId = fu.data.family_id as string;

    // Authorise the caller as an owner of that household before any privileged read.
    const { data: isOwner, error: ownErr } = await (context.supabase as any).rpc("is_family_owner", {
      _family_id: familyId,
    });
    if (ownErr) throw ownErr;
    if (!isOwner) throw new Error("Only household owners can preview caregiver access");

    const [prof, cals, srcs] = await Promise.all([
      admin.from("babysitter_access_profiles").select("date_scope").eq("family_user_id", fu.data.id).maybeSingle(),
      admin.from("babysitter_access_calendars").select("calendar_source_id").eq("family_user_id", fu.data.id),
      admin.from("calendar_sources").select("*").eq("family_id", familyId),
    ]);
    for (const r of [prof, cals, srcs]) if (r.error) throw r.error;
    if (!prof.data) throw new Error("This person has no caregiver access");

    const permitted = new Set<string>((cals.data ?? []).map((c: any) => c.calendar_source_id));
    const sources: CalendarSource[] = (srcs.data ?? []).map((s: any) => ({
      ...s,
      calendar_kind: s.calendar_kind ?? "custom",
    }));
    const calendars = sources.filter((s) => permitted.has(s.id) && s.active).map((s) => s.name);
    const scope = prof.data.date_scope as CaregiverPreview["date_scope"];

    if (scope === "shift_days_only") {
      const { loadSecureCaregiverOccurrences } = await import("@/lib/caregiver-occurrences.server");
      const events = await loadSecureCaregiverOccurrences(fu.data.user_id, familyId, sources);
      return { date_scope: scope, calendars, events };
    }

    if (permitted.size === 0) return { date_scope: scope, calendars, events: [] };
    const ev = await admin
      .from("events")
      .select("id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, category_id, recurrence_rule, recurrence_until, excluded_dates, event_members(family_member_id, weekdays)")
      .eq("family_id", familyId)
      .in("calendar_source_id", [...permitted]);
    if (ev.error) throw ev.error;
    const events = (ev.data ?? []).map((e: any) => ({
      ...e,
      family_id: familyId,
      display_mode: sources.find((s) => s.id === e.calendar_source_id)?.display_mode ?? "events",
      read_only: true,
      source_color: null,
      source_icon: null,
      source_name: null,
      excluded_dates: e.excluded_dates ?? [],
      needs_family_assignment: false,
      created_at: null,
      external_event_id: null,
      external_recurring_event_id: null,
      participants: (e.event_members ?? []).map((l: any) => ({ member_id: l.family_member_id, weekdays: l.weekdays ?? null })),
      member_ids: (e.event_members ?? []).map((l: any) => l.family_member_id),
      shift_assignment: null,
    })) as CalendarEvent[];
    return { date_scope: scope, calendars, events };
  });
