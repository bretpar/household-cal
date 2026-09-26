/** Owner-only, one-time import of an uploaded .ics file into an OFC calendar. */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ownedFamily(context: { supabase: unknown; userId: string }): Promise<string> {
  const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
  const family = await resolveOwnedFamily(context.supabase as never, context.userId);
  if (!family) throw new Error("Only household owners can import calendar files");
  return family;
}

export const previewCalendarFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string; source_id: string | null }) => input)
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/ics/file-import.server");
    const text = m.assertIcsText(data.text);
    const familyId = await ownedFamily(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const zone = await m.householdZone(supabaseAdmin, familyId);
    const { rows, cancelled } = m.prepareRows(text, zone);
    if (rows.length === 0) throw new Error("No events were found in that file");
    if (rows.length > m.MAX_EVENTS) throw new Error(`That file has more than ${m.MAX_EVENTS} events`);

    let duplicates = 0;
    let googleBound = false;
    if (data.source_id) {
      const dest = await m.resolveImportDestination(supabaseAdmin, familyId, data.source_id);
      googleBound = dest.googleBound;
      const existing = await m.existingFingerprints(supabaseAdmin, familyId, dest.id);
      duplicates = rows.filter((r) => existing.has(m.fingerprint(r))).length;
    }
    return {
      total: rows.length,
      recurring: rows.filter((r) => r.recurrence_rule).length,
      allDay: rows.filter((r) => r.all_day).length,
      cancelled,
      duplicates,
      googleBound,
      unsupported: m.unsupportedFields(text),
    };
  });

/** Imports one bounded batch. Re-checks duplicates each time, so a retry never duplicates. */
export const importCalendarFileBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { text: string; source_id: string; offset: number; google_confirmed: boolean }) => input,
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/ics/file-import.server");
    const text = m.assertIcsText(data.text);
    const offset = Math.max(0, Math.floor(Number(data.offset) || 0));
    const familyId = await ownedFamily(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dest = await m.resolveImportDestination(supabaseAdmin, familyId, data.source_id);
    if (dest.googleBound && !data.google_confirmed) {
      throw new Error("Confirm that imported events may be copied to Google");
    }
    const zone = await m.householdZone(supabaseAdmin, familyId);
    const { rows } = m.prepareRows(text, zone);
    if (rows.length > m.MAX_EVENTS) throw new Error(`That file has more than ${m.MAX_EVENTS} events`);

    const slice = rows.slice(offset, offset + m.BATCH_SIZE);
    const existing = await m.existingFingerprints(supabaseAdmin, familyId, dest.id);
    const fresh = [];
    let skipped = 0;
    for (const row of slice) {
      const key = m.fingerprint(row);
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      fresh.push(row);
    }

    let createdIds: string[] = [];
    if (fresh.length > 0) {
      const { data: inserted, error } = await supabaseAdmin
        .from("events")
        .insert(
          fresh.map((row) => ({
            ...row,
            family_id: familyId,
            calendar_source_id: dest.id,
            event_type: "other" as const,
            category_id: null,
            created_by: context.userId,
            needs_family_assignment: false,
            last_change_source: "app",
          })),
        )
        .select("id");
      if (error) throw error;
      createdIds = ((inserted ?? []) as { id: string }[]).map((r) => r.id);
    }

    // Only for calendars already sending to Google; anything not pushed within
    // the budget is picked up by the regular background sync.
    if (dest.googleBound && createdIds.length > 0) {
      const sync = await import("@/lib/google/sync.server");
      const deadline = Date.now() + 8000;
      for (const id of createdIds) {
        if (Date.now() > deadline) break;
        try {
          await sync.pushEvent(supabaseAdmin as never, familyId, id);
        } catch (error) {
          console.error("[ics-file-import] push failed", error instanceof Error ? error.message : error);
        }
      }
    }

    const next = offset + slice.length;
    return { created: createdIds.length, skipped, next, total: rows.length, done: next >= rows.length };
  });
