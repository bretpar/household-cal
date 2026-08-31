import { createFileRoute } from "@tanstack/react-router";

import { authenticateSchedulerRequest } from "@/lib/scheduler-auth.server";

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
      POST: async ({ request }) => {
        // The database scheduler authenticates with its own token; Lovable's
        // cron secret keeps working for platform-triggered runs.
        const schedulerToken = process.env["GOOGLE_SYNC_SCHEDULER_TOKEN"];
        const bearer = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        let authorized = false;
        if (schedulerToken && bearer) {
          const { createHash, timingSafeEqual } = await import("node:crypto");
          const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
          authorized = timingSafeEqual(digest(bearer), digest(schedulerToken));
        }
        if (!authorized) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }


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
        return Response.json({ households: (connections ?? []).length, results });
      },
    },
  },
});
