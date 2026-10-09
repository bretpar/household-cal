import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { StartupHeartReveal, StartupSplash } from "@/components/StartupSplash";
import { hasLayoutMounted, markLayoutMounted, resolveGuard, retryGuard } from "@/lib/auth-guard";
import { CalendarProvider, useCalendar } from "@/lib/calendar-store";
import { UserPreferencesProvider } from "@/lib/user-preferences";
import { useCaregiver } from "@/lib/use-caregiver";

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
  pendingComponent: StartupLoading,
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
  const [calState, setCalState] = useState({ loading: true, failed: false });
  // Household verification exhausted its fallback: show the access-error
  // screen with a retry instead of loading forever. No tabs or household
  // data mount while this is set.
  const [accessError, setAccessError] = useState(false);

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
      if ("accessError" in result) {
        setAccessError(true);
        return;
      }
      setEverReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, everReady]);

  // Try again: drop stale failed/in-flight guard state and re-run the full
  // auth + household check; success mounts the shell fresh (caregiver
  // classification and the calendar bundle then load from scratch).
  const retryAccess = () => {
    setAccessError(false);
    void (async () => {
      const result = await retryGuard(pathname);
      if ("redirectTo" in result) {
        if (result.redirectTo !== pathname) navigate({ to: result.redirectTo, replace: true });
        return;
      }
      if ("accessError" in result) {
        setAccessError(true);
        return;
      }
      setEverReady(true);
    })();
  };

  // One overlay instance for guard + household + first calendar load: it sits
  // in a fixed slot so it is never unmounted/recreated between those phases.
  return (
    <>
      {everReady ? (
        <UserPreferencesProvider>
          <CalendarProvider>
            <Outlet />
            <EventDetailsDialog />
            <PasteEventDialog />
            <CopiedEventBar />
            <CalendarLoadReporter onChange={setCalState} />
          </CalendarProvider>
        </UserPreferencesProvider>
      ) : accessError ? (
        <div className="mx-auto max-w-sm space-y-3 px-4 py-24 text-center">
          <p className="text-sm text-muted-foreground">We couldn't confirm your access.</p>
          <button
            type="button"
            onClick={retryAccess}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      ) : null}
      {/* Onboarding / no-household screens have no calendar to wait for: once
          the guard passes, the splash must never stay above them. */}
      <StartupHeartReveal
        loading={!everReady && !accessError ? true : !pathname.startsWith("/onboarding") && calState.loading}
        failed={accessError || calState.failed || (everReady && pathname.startsWith("/onboarding"))}
      />
    </>
  );
}

/** Branded startup screen matching the native iOS launch screen. */
function StartupLoading() {
  return <StartupSplash />;
}

function CalendarLoadReporter({
  onChange,
}: {
  onChange: (s: { loading: boolean; failed: boolean }) => void;
}) {
  const { loadError } = useCalendar();
  const { resolved, failed } = useCaregiver();
  // The shell (tabs) shows once membership and caregiver status are verified;
  // calendar events load independently behind in-page loading states.
  const busy = !resolved && !loadError && !failed;
  useEffect(() => {
    onChange({ loading: busy, failed: loadError || failed });
  }, [busy, loadError, failed, onChange]);
  return null;
}
