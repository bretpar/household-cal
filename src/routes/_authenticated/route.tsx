import { createFileRoute, Outlet, redirect, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { AppTourProvider } from "@/components/AppTour";
import { AppShell, PersistentAppShell } from "@/components/AppShell";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { StartupHeartReveal, StartupSplash } from "@/components/StartupSplash";
import {
  getVerifiedMembership,
  hasLayoutMounted,
  markLayoutMounted,
  resolveGuard,
  retryGuard,
  subscribeVerifiedMembership,
} from "@/lib/auth-guard";
import { useAppResume } from "@/lib/use-app-resume";
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
  // Once the layout is mounted, keep the shell + current page on screen while
  // a tab navigation re-checks access, instead of swapping in the splash.
  pendingMs: 60_000,
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
  // Shared by Try again, warm resume and lost-membership recovery. Handles
  // success, redirects and access errors even while the shell is mounted:
  // on failure the shell unmounts (no stale tabs) and the error UI shows.
  const verifying = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  // One bounded verification. A failure leaves the neutral error screen in
  // place and never schedules another check on its own.
  const reverify = () => {
    if (verifying.current) return;
    verifying.current = true;
    setChecking(true);
    void (async () => {
      try {
        const path = pathRef.current;
        const result = await retryGuard(path);
        if ("redirectTo" in result) {
          if (result.redirectTo !== path) navigate({ to: result.redirectTo, replace: true });
          return;
        }
        if ("accessError" in result) {
          setEverReady(false);
          setAccessError(true);
          return;
        }
        // Refresh route context (guard cache makes this pass without a
        // round-trip) so a stale navigation error doesn't re-trigger.
        await router.invalidate();
        setAccessError(false);
        setEverReady(true);
      } catch {
        setEverReady(false);
        setAccessError(true);
      } finally {
        verifying.current = false;
        setChecking(false);
      }
    })();
  };
  const retryAccess = reverify;

  // Navigation-level guard failure: beforeLoad returned { accessError } after
  // the layout was mounted. Tear down the protected shell (no tabs, no role
  // state, no page) and show the same neutral error screen as startup.
  const routeContext = Route.useRouteContext() as Record<string, unknown>;
  const navAccessError = everReady && routeContext?.["accessError"] === true;
  useEffect(() => {
    if (!navAccessError) return;
    setEverReady(false);
    setAccessError(true);
  }, [navAccessError]);

  // Warm resume: explicitly rerun the bounded auth + household verification.
  useAppResume(() => {
    if (everReady || accessError) reverify();
  });

  // An auth re-emit (e.g. Safari SIGNED_IN on foreground) clears the verified
  // membership; re-verify instead of leaving the calendar disabled.
  const membership = useSyncExternalStore(subscribeVerifiedMembership, getVerifiedMembership, () => null);
  useEffect(() => {
    if (everReady && !membership && !pathname.startsWith("/onboarding")) reverify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everReady, membership]);

  // One overlay instance for guard + household + first calendar load: it sits
  // in a fixed slot so it is never unmounted/recreated between those phases.
  // When access could not be verified the splash steps aside at once — the
  // error message and its retry button must stay visible and clickable, and
  // the calendar's own loading state is irrelevant there.
  const splashLoading = accessError || navAccessError
    ? false
    : !everReady
      ? true
      : !pathname.startsWith("/onboarding") && calState.loading;
  return (
    <>
      {everReady && !navAccessError ? (
        <UserPreferencesProvider>
          <CalendarProvider>
            <AppTourProvider>
            <PersistentAppShell>
              <Outlet />
            </PersistentAppShell>
            <EventDetailsDialog />
            <PasteEventDialog />
            <CopiedEventBar />
            <CalendarLoadReporter onChange={setCalState} />
            </AppTourProvider>
          </CalendarProvider>
        </UserPreferencesProvider>
      ) : accessError || navAccessError ? (
        <div role="alert" className="mx-auto max-w-sm space-y-3 px-4 py-24 text-center">
          <p className="text-sm text-muted-foreground">We couldn't confirm your access.</p>
          <button
            type="button"
            onClick={retryAccess}
            disabled={checking}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {checking ? "Checking…" : "Try again"}
          </button>
        </div>
      ) : null}
      {/* Onboarding / no-household screens have no calendar to wait for: once
          the guard passes, the splash must never stay above them. */}
      <StartupHeartReveal
        loading={splashLoading}
        failed={accessError || calState.failed || (everReady && pathname.startsWith("/onboarding"))}
      />
    </>
  );
}

/** Branded startup screen matching the native iOS launch screen. */
function StartupLoading() {
  // Only the initial document startup may show the full-screen splash.
  if (hasLayoutMounted()) return null;
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
