import { createFileRoute } from "@tanstack/react-router";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

/**
 * Periodic refresh for read-only Apple/iCloud subscriptions.
 *
 * ICS feeds cannot notify us of changes, so this is the only way imported events
 * stay current. Each subscription is reconciled by its stable feed identifiers,
 * so a run can never duplicate events, and Google sync is untouched.
 */
export const Route = createFileRoute("/api/public/ics/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("ics-subscriptions-refresh", request, async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { refreshAllSubscriptions } = await import("@/lib/ics/import.server");
          // Account-deletion retries run first and independently, so an Apple
          // feed outage can never block them (and they never block the refresh).
          let deletionRetry: unknown = null;
          try {
            const { retryPendingAccountDeletions } = await import("@/lib/account-deletion.server");
            deletionRetry = await retryPendingAccountDeletions(supabaseAdmin as never);
          } catch (error) {
            console.error("[account-deletion] retry failed", error);
          }
          const result = await refreshAllSubscriptions(supabaseAdmin as never);
          return { ...(result as object), deletionRetry };
        }),
    },
  },
});
