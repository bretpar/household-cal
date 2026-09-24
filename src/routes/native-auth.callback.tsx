import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { NATIVE_AUTH_SCHEME_CALLBACK, isValidHandoffCode, isValidNativeState } from "@/lib/native-auth";

/**
 * Universal Link target. When iOS hands the link to the app, this page never renders.
 * If it opens in Safari instead, offer the app-scheme fallback (the code alone is
 * useless without the verifier held by the app).
 */
export const Route = createFileRoute("/native-auth/callback")({
  validateSearch: (s: Record<string, unknown>): { code?: string; state?: string } =>
    isValidHandoffCode(s["code"]) && isValidNativeState(s["state"]) ? { code: s["code"], state: s["state"] } : {},
  head: () => ({
    meta: [
      { title: "Return to the app — Our Family Calendar" },
      { name: "description", content: "Finish signing in to the Our Family Calendar app." },
      { property: "og:title", content: "Return to the app — Our Family Calendar" },
      { property: "og:description", content: "Finish signing in to the Our Family Calendar app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallbackPage,
});

function CallbackPage() {
  const { code, state } = Route.useSearch();
  let href: string | null = null;
  if (code && state) {
    const u = new URL(NATIVE_AUTH_SCHEME_CALLBACK);
    u.searchParams.set("code", code);
    u.searchParams.set("state", state);
    href = u.toString();
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm space-y-4">
        <h1 className="font-display text-2xl font-bold">Our Family Calendar</h1>
        {href ? (
          <Button asChild className="w-full">
            <a href={href}>Open the app</a>
          </Button>
        ) : (
          <p className="text-muted-foreground">This link is invalid or has expired.</p>
        )}
      </div>
    </div>
  );
}
