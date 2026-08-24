import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CopiedEventBar } from "@/components/CopiedEventBar";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { PasteEventDialog } from "@/components/PasteEventDialog";
import { supabase } from "@/integrations/supabase/client";
import { ensureFamilyMembership } from "@/lib/calendar.functions";
import { CalendarProvider } from "@/lib/calendar-store";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // resolves an existing membership or claims a pending invitation; brand-new
    // users get no household and are sent to onboarding to create their own
    const onOnboarding = location.pathname.startsWith("/onboarding");
    const resolved = await ensureFamilyMembership().catch(() => ({ family_id: null }));
    if (!resolved?.family_id && !onOnboarding) throw redirect({ to: "/onboarding" });

    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <CalendarProvider>
      <Outlet />
      <EventDetailsDialog />
      <PasteEventDialog />
      <CopiedEventBar />
    </CalendarProvider>
  );
}
