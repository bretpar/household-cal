import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { authenticateSchedulerRequest } from "@/lib/scheduler-auth.server";

/**
 * Restricted administrative recovery: re-queues an exhausted account deletion.
 * Requires the server-only scheduler credential (same as the scheduled jobs);
 * there is no user-facing interface. Never restores account access.
 */
export const Route = createFileRoute("/api/public/account-deletion/requeue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateSchedulerRequest(request);
        if (denied) return denied;
        const parsed = z.object({ user_id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Invalid request", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { requeueFailedAccountDeletion, recoverStalePendingDeletions } = await import(
          "@/lib/account-deletion.server"
        );
        // Stuck "pending" jobs: rolled back only if abandoned and nothing was removed.
        const stale = await recoverStalePendingDeletions(supabaseAdmin as never, parsed.data.user_id);
        const result = await requeueFailedAccountDeletion(supabaseAdmin as never, parsed.data.user_id);
        return Response.json({ ...result, stale });
      },
    },
  },
});
