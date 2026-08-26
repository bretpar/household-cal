import { createFileRoute } from "@tanstack/react-router";
import { CalendarCog, Eye, Palette, RefreshCw, Users } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CalendarSyncSettings } from "@/components/CalendarSyncSettings";
import { DeveloperTools } from "@/components/DeveloperTools";
import { EmailSummarySettings } from "@/components/EmailSummarySettings";
import { EventCategorySettings } from "@/components/EventCategorySettings";
import { FamilyMemberSettings } from "@/components/FamilyMemberSettings";
import { GoogleSyncSummary } from "@/components/GoogleSyncSummary";
import { HouseholdAccess } from "@/components/HouseholdAccess";
import { MemberBadge } from "@/components/MemberBadge";
import { SettingsSection } from "@/components/SettingsSection";
import { Switch } from "@/components/ui/switch";
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
  const { members, sources, family, role } = useCalendar();
  const caregivers = members.filter((m) => m.role === "caregiver");

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

        <FamilyMemberSettings />

        {caregivers.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
              Caregivers
            </h2>
            {caregivers.map((caregiver) => (
              <article
                key={caregiver.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-dashed border-border bg-coverage/60 p-4"
              >
                <MemberBadge id={caregiver.id} size="lg" />
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold">{caregiver.name}</h3>
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

        <EventCategorySettings />

        <HouseholdAccess />

        <EmailSummarySettings />

        <CalendarSyncSettings />

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </h2>
          <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
            {sources.map((source) => (
              <div
                key={source.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{source.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {source.display_mode === "coverage_background"
                      ? "Coverage background layer"
                      : "Standard events"}{" "}
                    · {source.provider === "google" ? "Google calendar" : "Google sync coming soon"}
                  </p>
                </div>
                <Switch defaultChecked={source.active} aria-label={`Show ${source.name}`} />
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-bold">Week starts on Monday</p>
                <p className="text-xs text-muted-foreground">Applies to month and week views</p>
              </div>
              <Switch defaultChecked aria-label="Week starts on Monday" />
            </div>
          </div>
        </section>

        <DeveloperTools />
      </div>
    </AppShell>
  );
}
