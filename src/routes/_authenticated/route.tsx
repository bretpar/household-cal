import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import logoAsset from "@/assets/logo.png.asset.json";
import { useEffect, useState } from "react";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { hasLayoutMounted, markLayoutMounted, resolveGuard } from "@/lib/auth-guard";
import { CalendarProvider } from "@/lib/calendar-store";
import { UserPreferencesProvider } from "@/lib/user-preferences";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async ({ location }) => {
    if (typeof window !== "undefined" && !hasLayoutMounted()) {
      // Initial hydration: match the server shell; the layout effect below
      // performs the guard right after mount and redirects if needed.
      return { user: null };
    }
    const result = await resolveGuard(location.pathname);
    if ("redirectTo" in result) throw redirect({ to: result.redirectTo });
    return result;
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  // Re-run the guard on every pathname change: the membership check may itself
  // trigger a navigation (e.g. fresh signup -> /onboarding), and without this
  // dependency the layout would stay unready forever after that redirect.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Once the guard has passed once, keep the shell (header + bottom nav + page)
  // mounted while re-validating on later tab navigations. Blanking the tree on
  // every pathname change is what made tab switches flash an empty screen.
  const [everReady, setEverReady] = useState(false);

  useEffect(() => {
    markLayoutMounted();
    // After the first pass, beforeLoad gates every client navigation; running
    // the guard here again would only duplicate its auth + household requests.
    if (everReady) return;
    let cancelled = false;
    void (async () => {
      const result = await resolveGuard(pathname);
      if (cancelled) return;
      if ("redirectTo" in result) {
        // Only redirect when the guard disagrees with the current path; on
        // the destination path the guard passes, so no redirect loop forms.
        if (result.redirectTo !== pathname) {
          navigate({ to: result.redirectTo, replace: true });
        }
        return;
      }
      setEverReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, everReady]);

  if (!everReady) return <StartupLoading />;

  return (
    <UserPreferencesProvider>
      <CalendarProvider>
        <Outlet />
        <EventDetailsDialog />
        <PasteEventDialog />
        <CopiedEventBar />
      </CalendarProvider>
    </UserPreferencesProvider>
  );
}

/** Stable branded placeholder while sign-in and household are confirmed. */
function StartupLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background"
    >
      <img src={logoAsset.url} alt="" className="h-16 w-16 animate-pulse rounded-2xl object-contain" />
      <p className="font-display text-base font-semibold text-muted-foreground">
        Loading your calendar…
      </p>
    </div>
  );
}
