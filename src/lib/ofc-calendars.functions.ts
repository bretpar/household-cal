/**
 * Owner-only management of user-created OFC calendars (provider = "local",
 * calendar_kind = "custom"). The household Family calendar, legacy internal
 * rows and connected Google/Apple calendars are never touched here.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("Calendar name is required");
  if (name.length > 60) throw new Error("Calendar name must be 60 characters or fewer");
  return name;
}

async function ownedFamily(context: { supabase: unknown; userId: string }): Promise<string> {
  const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
  const family = await resolveOwnedFamily(context.supabase as never, context.userId);
  if (!family) throw new Error("Only household owners can manage calendars");
  return family;
}

async function assertCustomCalendar(familyId: string, sourceId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_sources")
    .select("id, provider, calendar_kind")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.provider !== "local" || data.calendar_kind !== "custom") {
    throw new Error("Only calendars you created in Our Family Calendar can be changed here");
  }
  return supabaseAdmin;
}

export const createOfcCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      name: string;
      color: string;
      icon: string | null;
      display_mode: "events" | "coverage_background";
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { assertCalendarColor, assertCalendarIcon } = await import("@/lib/calendar-appearance");
    const name = cleanName(data.name);
    const color = assertCalendarColor(data.color);
    const icon = assertCalendarIcon(data.icon);
    if (data.display_mode !== "events" && data.display_mode !== "coverage_background") {
      throw new Error("Unknown display style");
    }
    const familyId = await ownedFamily(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin
      .from("calendar_sources")
      .select("sort_order")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const { data: row, error } = await supabaseAdmin
      .from("calendar_sources")
      .insert({
        family_id: familyId,
        name,
        provider: "local",
        calendar_kind: "custom",
        display_mode: data.display_mode,
        color,
        display_icon: icon,
        active: true,
        is_main: false,
        selectable_in_email: false,
        sort_order: (last?.[0]?.sort_order ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id as string };
  });

export const renameOfcCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; name: string }) => input)
  .handler(async ({ data, context }) => {
    const name = cleanName(data.name);
    const familyId = await ownedFamily(context);
    const admin = await assertCustomCalendar(familyId, data.source_id);
    const { error } = await admin
      .from("calendar_sources")
      .update({ name })
      .eq("id", data.source_id)
      .eq("family_id", familyId);
    if (error) throw error;
    return { ok: true as const };
  });

/** Archive = inactive. Events on the calendar are kept untouched. */
export const archiveOfcCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string }) => input)
  .handler(async ({ data, context }) => {
    const familyId = await ownedFamily(context);
    const admin = await assertCustomCalendar(familyId, data.source_id);
    const { error } = await admin
      .from("calendar_sources")
      .update({ active: false })
      .eq("id", data.source_id)
      .eq("family_id", familyId);
    if (error) throw error;
    return { ok: true as const };
  });
