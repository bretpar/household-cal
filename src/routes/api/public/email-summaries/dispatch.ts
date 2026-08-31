import { createFileRoute } from "@tanstack/react-router";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

/**
 * Scheduled sender for email summaries.
 *
 * Runs every 5 minutes from the database scheduler and does two passes: it
 * refreshes the connected Google calendars for schedules that send within the
 * next 5 minutes, then sends whatever is due. Each enabled schedule decides for
 * itself whether its household-local send time has passed; duplicate protection
 * lives in `email_summary_sends` (emails) and `email_summary_presyncs`
 * (refreshes), so extra runs are safe.
 */
export const Route = createFileRoute("/api/public/email-summaries/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("email-summaries-dispatch", request, async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { dispatchDueSummaries } = await import("@/lib/email-summaries/dispatch.server");
          return dispatchDueSummaries(supabaseAdmin, new Date());
        }),
    },
  },
});
