import { createFileRoute } from "@tanstack/react-router";

/**
 * Apple App Site Association for Universal Links. Served only once the
 * APPLE_TEAM_ID secret is configured (10-char Apple Developer Team ID).
 */
export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async () => {
        const teamId = process.env["APPLE_TEAM_ID"];
        if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return new Response("Not found", { status: 404 });
        const body = {
          applinks: {
            details: [
              {
                appIDs: [`${teamId}.com.ourfamilycalendar.app`],
                components: [{ "/": "/native-auth/callback", comment: "Native Google sign-in return" }],
              },
            ],
          },
        };
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
