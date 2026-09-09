import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CalendarCog,
  ChevronRight,
  Eye,
  House,
  LockKeyhole,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useCalendar } from "@/lib/calendar-store";



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
  const { members, sources, family, role } = useCalendar();
  const caregivers = members.filter((m) => m.role === "caregiver");

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (

    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">{family?.name ?? "Family"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone on the calendar, their color and what they can do.
            {role ? ` You are signed in as ${ROLE_LABEL[role] ?? role}.` : ""}
          </p>
        </header>

        <SettingsSection
          title="Household"
          description="Family members, colors, users, invitations and access"
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
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-dashed border-border bg-coverage/60 p-4"
                >
                  <MemberBadge id={caregiver.id} size="lg" />
                  <div className="min-w-0">
                    <h4 className="truncate text-base font-bold">{caregiver.name}</h4>
                    <p className="text-xs font-semibold text-muted-foreground">
                      Shown as coverage shading, not events
                    </p>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
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
          title="Calendars & Sync"
          description="Google connection, synced calendars, timezone and schedule summaries"
          icon={<RefreshCw className="h-5 w-5" aria-hidden />}
        >
          <CalendarSyncSettings />
          <EmailSummarySettings />
        </SettingsSection>

        <SettingsSection
          title="Event Settings"
          description="Categories and calendar display preferences"
          icon={<SlidersHorizontal className="h-5 w-5" aria-hidden />}
        >
          <EventCategorySettings />
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
            <CalendarCog className="h-4 w-4" aria-hidden />
            Calendar preferences
          </h2>
          <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
            <CalendarDefaultViewSetting />
            {sources.map((source) => (
              <div
                key={source.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">Show “{source.name}” on the calendar</p>
                  <p className="text-xs text-muted-foreground">
                    {source.display_mode === "coverage_background"
                      ? "Drawn as background coverage shading instead of event cards"
                      : "Drawn as normal event cards"}{" "}
                    · Not active yet — use the member and category filters on the calendar
                  </p>
                </div>
                <Switch
                  checked={source.active}
                  disabled
                  aria-label={`Show ${source.name} on the calendar`}
                />
              </div>
            ))}
            <WeekStartSetting />
            <Link
              to="/preferences"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 transition-colors hover:bg-surface-muted"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">All my preferences</p>
                <p className="text-xs text-muted-foreground">
                  Week start day and default view, saved to your account
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </Link>
          </div>
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
        </SettingsSection>

        <SettingsSection
          title="Maintenance"
          description="Locked diagnostics, repairs and QA tools"
          icon={<LockKeyhole className="h-5 w-5" aria-hidden />}
          tone="muted"
        >
          <GoogleCalendarMaintenance>
            <DeveloperTools />
          </GoogleCalendarMaintenance>
        </SettingsSection>
      </div>
    </AppShell>
  );
}

