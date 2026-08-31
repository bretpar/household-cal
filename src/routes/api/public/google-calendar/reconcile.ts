import { createFileRoute } from "@tanstack/react-router";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

/**
 * Periodic reconciliation safety net.
 *
 * Runs for every household with a connected Google account: re-reads the sync
 * window, repairs missed creates/updates/deletes through the existing link
 * table (so it cannot duplicate anything) and refreshes push channels.
 */
export const Route = createFileRoute("/api/public/google-calendar/reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("google-calendar-reconcile", request, async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { reconcileHousehold } = await import("@/lib/google/sync.server");

          const { data: connections } = await supabaseAdmin
            .from("google_connections")
            .select("family_id")
            .eq("status", "connected");

          const results: Record<string, unknown> = {};
          for (const row of (connections ?? []) as { family_id: string }[]) {
            results[row.family_id] = await reconcileHousehold(supabaseAdmin, row.family_id);
          }
          return { households: (connections ?? []).length, results };
        }),
    },
  },
});
