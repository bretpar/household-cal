import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

const manualSyncPayload = z.object({
  family_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  initial: z.boolean().optional().default(false),
});

/** Durable callback for one manual sync already accepted by the database lock. */
export const Route = createFileRoute("/api/public/google-calendar/manual-sync")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("google-calendar-manual-sync", request, async () => {
          const payload = manualSyncPayload.parse(await request.json());
          console.log("[google-sync] durable manual sync started", {
            familyId: payload.family_id,
            attemptId: payload.attempt_id,
          });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runAcceptedManualSync } = await import("@/lib/google/sync.server");
          await runAcceptedManualSync(
            supabaseAdmin,
            payload.family_id,
            payload.attempt_id,
            payload.initial,
          );
          return { family_id: payload.family_id, attempt_id: payload.attempt_id };
        }),
    },
  },
});