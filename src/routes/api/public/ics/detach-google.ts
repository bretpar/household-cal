import { createFileRoute } from "@tanstack/react-router";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

/**
 * One-off repair: removes the Google copies that were created from read-only
 * Apple/iCloud subscription events before subscription sources were excluded
 * from outbound push. App-side Apple events and the Apple source are untouched.
 */
export const Route = createFileRoute("/api/public/ics/detach-google")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("ics-detach-google", request, async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { pushEventDeletion } = await import("@/lib/google/sync.server");

          const { data: sources } = await supabaseAdmin
            .from("calendar_sources")
            .select("id, family_id")
            .eq("provider", "ics");
          const byFamily = new Map<string, string[]>();
          for (const s of (sources ?? []) as { id: string; family_id: string }[]) {
            byFamily.set(s.family_id, [...(byFamily.get(s.family_id) ?? []), s.id]);
          }

          let googleDeleted = 0;
          for (const [familyId, sourceIds] of byFamily) {
            const { data: rows } = await supabaseAdmin
              .from("events")
              .select("id")
              .eq("family_id", familyId)
              .in("calendar_source_id", sourceIds);
            const eventIds = ((rows ?? []) as { id: string }[]).map((r) => r.id);
            if (eventIds.length === 0) continue;
            const { data: links } = await supabaseAdmin
              .from("event_sync_links")
              .select("id, google_event_id, calendar_source_id")
              .eq("family_id", familyId)
              .in("event_id", eventIds);
            const linkRows = (links ?? []) as {
              id: string;
              google_event_id: string;
              calendar_source_id: string;
            }[];
            if (linkRows.length === 0) continue;
            await pushEventDeletion(supabaseAdmin as never, familyId, linkRows);
            await supabaseAdmin
              .from("event_sync_links")
              .delete()
              .in(
                "id",
                linkRows.map((l) => l.id),
              );
            googleDeleted += linkRows.length;
          }
          return { google_deleted: googleDeleted };
        }),
    },
  },
});
