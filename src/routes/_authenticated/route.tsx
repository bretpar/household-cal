import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { supabase } from "@/integrations/supabase/client";
import { ensureFamilyMembership } from "@/lib/calendar.functions";
import { CalendarProvider } from "@/lib/calendar-store";
import { UserPreferencesProvider } from "@/lib/user-preferences";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // resolves an existing membership or claims a pending invitation; brand-new
    // users get no household and are sent to onboarding to create their own.
    // A failed lookup must NOT be treated as "no household" — keep established
    // users in the app instead of bouncing them through onboarding.
    const onOnboarding = location.pathname.startsWith("/onboarding");
    let resolved: { family_id: string | null } | undefined;
    try {
      resolved = await ensureFamilyMembership();
    } catch {
      // leave `resolved` undefined so the error path below keeps the user in-app
    }

    if (resolved) {
      if (!resolved.family_id && !onOnboarding) {
        throw redirect({ to: "/onboarding" });
      }
      if (resolved.family_id && onOnboarding) {
        throw redirect({ to: "/calendar" });
      }
      return { user: data.user, family_id: resolved.family_id };
    }

    // membership check failed: do not redirect to onboarding; remain in the
    // authenticated app and let the current route decide how to degrade.
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
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
