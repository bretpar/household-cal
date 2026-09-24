import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { NATIVE_AUTH_CALLBACK, isValidNativeState } from "@/lib/native-auth";

/**
 * Opened by the iOS app in the system browser. Runs the normal Google sign-in,
 * then returns the session to the app via its URL scheme. The browser copy of
 * the session is then cleared locally (the refresh token stays valid for the app).
 */
export const Route = createFileRoute("/native-google-auth")({
  validateSearch: (search: Record<string, unknown>): { state?: string } =>
    isValidNativeState(search["state"]) ? { state: search["state"] } : {},
  head: () => ({
    meta: [
      { title: "Signing in — Our Family Calendar" },
      { name: "description", content: "Completing Google sign-in for the Our Family Calendar app." },
      { property: "og:title", content: "Signing in — Our Family Calendar" },
      { property: "og:description", content: "Completing Google sign-in for the Our Family Calendar app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NativeGoogleAuthPage,
});

function NativeGoogleAuthPage() {
  const { state } = Route.useSearch();
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) {
      setError("This sign-in link is invalid. Please try again from the app.");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const session = data.session;
      if (!session) {
        const result = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: `${window.location.origin}/native-google-auth?state=${state}`,
        });
        if (result.error) setError("Google sign-in failed. Please try again.");
        return;
      }
      const hash = new URLSearchParams({
        state,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      const url = `${NATIVE_AUTH_CALLBACK}#${hash.toString()}`;
      // Drop the browser-side copy without revoking the tokens handed to the app.
      await supabase.auth.signOut({ scope: "local" });
      setReturnUrl(url);
      window.location.href = url;
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm space-y-4">
        <h1 className="font-display text-2xl font-bold">Our Family Calendar</h1>
        {error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : returnUrl ? (
          <>
            <p className="text-muted-foreground">You're signed in.</p>
            <Button asChild className="w-full">
              <a href={returnUrl}>Return to the app</a>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Signing you in with Google…</p>
        )}
      </div>
    </div>
  );
}
