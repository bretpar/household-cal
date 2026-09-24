import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  BellRing,
  CalendarDays,
  Eye,
  House,
  LockKeyhole,
  LogOut,
  Unplug,
  UserRound,
} from "lucide-react";

import { AccountDeletion } from "@/components/AccountDeletion";
import { AppShell } from "@/components/AppShell";
import { AppleCalendarSubscriptions } from "@/components/AppleCalendarSubscriptions";
import { CalendarAppearanceSettings } from "@/components/CalendarAppearanceSettings";
import { CalendarDefaultViewSetting } from "@/components/CalendarDefaultViewSetting";
import { CalendarSyncSettings } from "@/components/CalendarSyncSettings";
import { DeveloperTools } from "@/components/DeveloperTools";
import { GoogleCalendarMaintenance } from "@/components/GoogleCalendarMaintenance";
import { EmailSummarySettings } from "@/components/EmailSummarySettings";
import { EventCategorySettings } from "@/components/EventCategorySettings";
import { FamilyMemberSettings } from "@/components/FamilyMemberSettings";
import { HouseholdAccess } from "@/components/HouseholdAccess";
import { MemberBadge } from "@/components/MemberBadge";
import { SettingsSection } from "@/components/SettingsSection";
import { WeekStartSetting } from "@/components/WeekStartSetting";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCalendar } from "@/lib/calendar-store";
import { SUPPORT_EMAIL } from "@/lib/support-contact";



export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "Family & Settings — Family Calendar" },
      {
        name: "description",
        content:
          "Household members, colors, roles, caregiver access and calendar settings in one place.",
      },
      { property: "og:title", content: "Family & Settings — Family Calendar" },
      {
        property: "og:description",
        content: "Manage who is on the calendar, their colors and their access level.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FamilyPage,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner · full access",
  editor: "Editor · can add and edit",
  viewer: "Viewer · view only",
};

function FamilyPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { members, family, role } = useCalendar();
  const caregivers = members.filter((m) => m.role === "caregiver");

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (

    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage {family?.name ?? "your family"}'s calendar, connections and household.
          </p>
        </header>

        <SettingsSection
          title="Calendar"
          description="Default view, week layout, categories and appearance"
          icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        >
          <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
            <CalendarDefaultViewSetting />
            <WeekStartSetting />
          </div>
          <CalendarAppearanceSettings />
          <EventCategorySettings />
        </SettingsSection>

        <SettingsSection
          title="Sync & Integrations"
          description="Connect and manage Google and Apple calendars"
          icon={<Unplug className="h-5 w-5" aria-hidden />}
        >
          <CalendarSyncSettings />
          <AppleCalendarSubscriptions />
        </SettingsSection>

        <SettingsSection
          title="Notifications / Emails"
          description="Schedule helpful calendar summaries"
          icon={<BellRing className="h-5 w-5" aria-hidden />}
        >
          <EmailSummarySettings />
        </SettingsSection>

        <SettingsSection
          title="Household"
          description="Family members, colors, invitations and access"
          icon={<House className="h-5 w-5" aria-hidden />}
        >
          <FamilyMemberSettings />

          {caregivers.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
                Caregivers
              </h3>
              {caregivers.map((caregiver) => (
                <article
                  key={caregiver.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-dashed border-border bg-coverage/60 p-4"
                >
                  <MemberBadge id={caregiver.id} size="lg" />
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-bold">{caregiver.name}</h4>
                    <p className="text-xs font-semibold text-muted-foreground">
                      Appears as background coverage
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    View only
                  </span>
                </article>
              ))}
            </section>
          ) : null}
          <HouseholdAccess />
        </SettingsSection>

        <SettingsSection
          title="Account"
          description="Your access level and sign-in controls"
          icon={<UserRound className="h-5 w-5" aria-hidden />}
        >
          <div className="rounded-2xl border border-border-soft bg-card p-4">
            <p className="text-sm font-bold">Signed-in access</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {role ? ROLE_LABEL[role] ?? role : "Household member"}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Need help?{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-foreground underline underline-offset-2"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={signOut}
            className="h-12 w-full rounded-full text-base font-bold"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Sign out
          </Button>
          <AccountDeletion />
        </SettingsSection>

        <section className="border-t border-border-soft pt-5">
          <SettingsSection
            title="Advanced / Maintenance"
            description="Locked troubleshooting and support tools"
            icon={<LockKeyhole className="h-5 w-5" aria-hidden />}
            tone="muted"
          >
            <GoogleCalendarMaintenance>
              <DeveloperTools />
            </GoogleCalendarMaintenance>
          </SettingsSection>
        </section>

        <footer className="space-y-2 rounded-3xl border border-dashed border-border bg-surface-muted/50 p-4 text-center">
          <nav className="flex items-center justify-center gap-4 text-sm font-semibold">
            <Link to="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-muted-foreground transition-colors hover:text-foreground">
              Terms of Service
            </Link>
          </nav>
          <p className="text-xs text-muted-foreground">© 2026 Our Family Calendar</p>
        </footer>
      </div>
    </AppShell>
  );
}

