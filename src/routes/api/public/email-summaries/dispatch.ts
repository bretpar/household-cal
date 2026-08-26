import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled sender for email summaries.
 *
 * Runs every 15 minutes from the database scheduler. Each enabled schedule
 * decides for itself whether its household-local send time has passed, and
 * duplicate protection lives in `email_summary_sends`, so extra runs are safe.
 */
export const Route = createFileRoute("/api/public/email-summaries/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        const { dispatchDueSummaries } = await import("@/lib/email-summaries/dispatch.server");
        const result = await dispatchDueSummaries(supabaseAdmin, new Date());
        return Response.json(result);
      },
    },
  },
});
