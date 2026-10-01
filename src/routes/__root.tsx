import type { ErrorComponentProps } from "@tanstack/react-router";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { installNativeAuthListener } from "@/lib/native-auth";
import { sanitizeReturnPath } from "@/lib/return-path";
import { hideNativeSplash } from "@/lib/native-splash";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Family Calendar" },
      {
        name: "description",
        content:
          "A warm shared household calendar: school, activities, work and caregiver coverage.",
      },
      { property: "og:title", content: "Family Calendar" },
      {
        property: "og:description",
        content: "One friendly place to see what everyone in the household is doing.",
      },

      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Our Family Calendar" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "theme-color", content: "#FAF8F4" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preload", href: "/launch-logo.png", as: "image" },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "icon", href: "/favicon-mark.png", type: "image/png", sizes: "64x64" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon-152.png", sizes: "152x152" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon-167.png", sizes: "167x167" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Nunito:wght@400;600;700;800&display=swap",
      },
    ],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    // iOS shell only: the first web paint matches the launch screen, so hand off.
    hideNativeSplash();
  }, []);

  useEffect(() => {
    // iOS shell only: receive the Google sign-in handoff from the system browser.
    void installNativeAuthListener(() => {
      const redirect = new URLSearchParams(window.location.search).get("redirect");
      window.location.assign(sanitizeReturnPath(redirect));
    }, (message) => toast.error(message));
  }, []);

  useEffect(() => {
    // Last signed-in user in this tab; a different user means drop all cached data.
    let lastUserId: string | null | undefined;
    const isPrivatePath = () =>
      /^\/(today|calendar|activities|family|preferences|onboarding)(\/|$)/.test(
        window.location.pathname,
      );
    const dropSessionData = async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
    };
    // Fires in this tab and (via the auth client's cross-tab broadcast) in other open tabs.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      const switched = lastUserId !== undefined && lastUserId !== userId;
      lastUserId = userId;
      if (event === "SIGNED_OUT") {
        void dropSessionData().then(() => {
          router.invalidate();
          if (isPrivatePath()) router.navigate({ to: "/auth", replace: true });
        });
        return;
      }
      if (event !== "SIGNED_IN" && event !== "USER_UPDATED") return;
      if (switched) {
        void dropSessionData().then(() => router.invalidate());
        return;
      }
      router.invalidate();
      queryClient.invalidateQueries();
    });

    // Safari back/forward cache: a restored private page is hidden behind a cream
    // curtain until the current session is confirmed for the same user.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !isPrivatePath()) return;
      const curtain = document.createElement("div");
      curtain.setAttribute("aria-hidden", "true");
      curtain.style.cssText = "position:fixed;inset:0;z-index:70;background:var(--background)";
      document.body.appendChild(curtain);
      void supabase.auth.getUser().then(({ data, error }) => {
        const userId = data.user?.id ?? null;
        // Network/server failures are not proof the session is gone: keep the
        // restored page and only bounce to sign-in on a definitive auth answer.
        const status = (error as { status?: number } | null)?.status;
        const transient = !navigator.onLine || (error && (!status || status >= 500));
        if (transient) {
          curtain.remove();
          return;
        }
        if (error || !userId || (lastUserId && userId !== lastUserId)) {
          window.location.replace(userId ? window.location.href : "/auth");
          return;
        }
        curtain.remove();
      });
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}

