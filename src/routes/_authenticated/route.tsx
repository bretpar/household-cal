import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
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

  // membership check failed: do not redirect to onboarding; remain in the
  // authenticated app and let the current route decide how to degrade.
  return { user: data.user };
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hasMountedOnce = true;
    let cancelled = false;
    void (async () => {
      const result = await resolveGuard(window.location.pathname);
      if (cancelled) return;
      if ("redirectTo" in result) {
        navigate({ to: result.redirectTo, replace: true });
        return;
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
