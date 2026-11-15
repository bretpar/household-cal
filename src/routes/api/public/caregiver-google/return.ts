import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/caregiver-google/return")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const { receiveCaregiverOAuth } = await import("@/lib/caregiver-google-oauth.server");
      const result = await receiveCaregiverOAuth(new URL(request.url).searchParams);
      const target = new URL("com.ourfamilycalendar.app://caregiver-google-callback");
      target.searchParams.set("attempt", result.attempt);
      target.searchParams.set("state", result.state);
      target.searchParams.set("success", String(result.success));
      const message = JSON.stringify({ type: result.success ? "appUserConnectorOAuthComplete" : "appUserConnectorOAuthFailed", connectorId: "google_calendar", code: result.success ? result.attempt : null }).replace(/</g, "\\u003c");
      const link = target.toString().replace(/&/g, "&amp;");
      const script = result.native
        ? `window.location.replace(${JSON.stringify(target.toString())});`
        : `if(window.opener){window.opener.postMessage(${message},window.location.origin);window.close();}`;
      return new Response(`<!doctype html><html><head><title>Our Family Calendar — Google connection</title><meta name="referrer" content="no-referrer"></head><body><p>${result.success ? "Return to Our Family Calendar to finish connecting." : "Google connection did not finish. Please try again."}</p>${result.native ? `<a href="${link}">Return to Our Family Calendar</a>` : ""}<script>${script}</script></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
    } catch {
      return new Response("Google connection return is invalid or expired. Please start again in the app.", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  } } },
});