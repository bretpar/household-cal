import { createFileRoute } from "@tanstack/react-router";

/**
 * Google Calendar push notification receiver.
 *
 * Google sends an empty body with channel headers, so the handler verifies the
 * channel token we registered, resolves the household from the channel id, and
 * then runs an incremental pull. Anything unverified is rejected.
 */
export const Route = createFileRoute("/api/public/google-calendar/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const channelId = request.headers.get("x-goog-channel-id");
        const token = request.headers.get("x-goog-channel-token");
        const state = request.headers.get("x-goog-resource-state");

        const expected = process.env["LOVABLE_CRON_SECRET"];
        if (!expected || !token || token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!channelId) return new Response("Missing channel", { status: 400 });
        // the first "sync" ping just confirms the channel is live
        if (state === "sync") return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { familyForChannel, pullHousehold } = await import("@/lib/google/sync.server");
        const owner = await familyForChannel(supabaseAdmin, channelId);
        if (!owner) return new Response("Unknown channel", { status: 404 });

        const result = await pullHousehold(supabaseAdmin, owner.familyId, false);
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
