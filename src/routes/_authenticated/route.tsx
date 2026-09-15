import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { supabase } from "@/integrations/supabase/client";
import { ensureFamilyMembership } from "@/lib/calendar.functions";
import { CalendarProvider } from "@/lib/calendar-store";
import { UserPreferencesProvider } from "@/lib/user-preferences";

// Set once the layout has mounted in the browser. On the very first page load
// the guard must NOT redirect inside beforeLoad: the server streamed the shell
// for the originally requested URL, and a redirect processed before hydration
// makes the client render a different tree than the streamed HTML (React
// hydration error #418), which regenerates the whole tree and races any input
// on the target page. Deferring the initial check to a post-mount effect keeps
// hydration identical to the server shell; later client-side navigations are
// still fully gated by beforeLoad.
let hasMountedOnce = false;

async function resolveGuard(pathname: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { redirectTo: "/auth" as const };

  // resolves an existing membership or claims a pending invitation; brand-new
  // users get no household and are sent to onboarding to create their own.
  // A failed lookup must NOT be treated as "no household" — keep established
  // users in the app instead of bouncing them through onboarding.
  const onOnboarding = pathname.startsWith("/onboarding");
  let resolved: { family_id: string | null } | undefined;
  try {
    resolved = await ensureFamilyMembership();
  } catch {
    // leave `resolved` undefined so the error path below keeps the user in-app
  }

  if (resolved) {
    if (!resolved.family_id && !onOnboarding) return { redirectTo: "/onboarding" as const };
    if (resolved.family_id && onOnboarding) return { redirectTo: "/calendar" as const };
    return { user: data.user, family_id: resolved.family_id };
  }

  // The server membership check failed. Fail closed only when we can confirm
  // the account truly has no household: read the caller's own membership rows
  // (the family_users SELECT policy allows user_id = auth.uid()). A confirmed
  // household-less account must not land on an empty calendar; if this read
  // also fails, the state is genuinely unknown, so keep the user in-app
  // rather than bouncing an established household through onboarding on a
  // transient error.
  if (!onOnboarding) {
    const { data: memberships, error: membershipError } = await supabase
      .from("family_users")
      .select("family_id")
      .eq("user_id", data.user.id)
      .limit(1);
    if (!membershipError && (memberships?.length ?? 0) === 0) {
      return { redirectTo: "/onboarding" as const };
    }
  }
  return { user: data.user };
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async ({ location }) => {
    if (typeof window !== "undefined" && !hasMountedOnce) {
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
  const [readyForPath, setReadyForPath] = useState<string | null>(null);

  useEffect(() => {
    hasMountedOnce = true;
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
      setReadyForPath(pathname);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const ready = readyForPath === pathname;

  if (!ready) return null;

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
