import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { completeNativeHandoff } from "@/lib/native-auth.functions";
import {
  NATIVE_AUTH_SCHEME_CALLBACK,
  NATIVE_AUTH_UNIVERSAL_CALLBACK,
  isValidNativeState,
  isValidRequestId,
} from "@/lib/native-auth";

/**
 * Opened by the iOS app in the system browser. Always performs a *fresh* Google
 * sign-in (an existing browser session is never reused), exchanges it server-side
 * for a one-time code bound to the app's verifier, and returns only that code.
 */
export const Route = createFileRoute("/native-google-auth")({
  validateSearch: (search: Record<string, unknown>): { request?: string; state?: string } =>
    isValidRequestId(search["request"]) && isValidNativeState(search["state"])
      ? { request: search["request"], state: search["state"] }
      : {},
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

function withParams(base: string, code: string, state: string) {
  const u = new URL(base);
  u.searchParams.set("code", code);
  u.searchParams.set("state", state);
  return u.toString();
}

function NativeGoogleAuthPage() {
  const { request, state } = Route.useSearch();
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request || !state) {
      setError("This sign-in link is invalid. Please try again from the app.");
      return;
    }
    const markerKey = `ofc-native-req-${request}`;
    let cancelled = false;

    const finish = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      sessionStorage.removeItem(markerKey);
      if (!session) throw new Error("no session");
      const { code } = await completeNativeHandoff({
        data: { requestId: request, refreshToken: session.refresh_token },
      });
      // The server rotated this refresh token into the handoff. Drop the browser copy
      // WITHOUT calling signOut(): a server-side logout (even scope "local") revokes the
      // whole session, including the rotated token the app is about to redeem.
      supabase.auth.stopAutoRefresh();
      for (const k of Object.keys(localStorage)) {
        if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k);
      }
      if (cancelled) return;
      setReturnUrl(withParams(NATIVE_AUTH_UNIVERSAL_CALLBACK, code, state));
      window.location.href = withParams(NATIVE_AUTH_SCHEME_CALLBACK, code, state);
    };

    (async () => {
      try {
        if (!sessionStorage.getItem(markerKey)) {
          // First visit: never reuse an existing browser session.
          sessionStorage.setItem(markerKey, "1");
          await supabase.auth.signOut({ scope: "local" });
          const result = await lovable.auth.signInWithOAuth("google", {
            redirect_uri: `${window.location.origin}/native-google-auth?request=${request}&state=${state}`,
          });
          if (result.error) throw result.error;
          if (result.redirected) return;
        }
        await finish();
      } catch {
        sessionStorage.removeItem(markerKey);
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!cancelled) setError("Google sign-in failed. Please return to the app and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, state]);

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
