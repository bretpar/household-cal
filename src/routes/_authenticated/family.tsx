import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import {
  BellRing,
  CalendarDays,
  ClipboardList,
  House,
  LockKeyhole,
  UserRound,
} from "lucide-react";


import { AccountDeletion } from "@/components/AccountDeletion";
import { AppShell } from "@/components/AppShell";
import { ParentOnly } from "@/components/CaregiverGate";
import { CalendarAppearanceSettings } from "@/components/CalendarAppearanceSettings";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";

import { CalendarDefaultViewSetting } from "@/components/CalendarDefaultViewSetting";
import { BuildDiagnostics } from "@/components/BuildDiagnostics";
import { CaregiverVisibilityDiagnostic } from "@/components/CaregiverVisibilityDiagnostic";
import { DeveloperTools } from "@/components/DeveloperTools";
import { GoogleCalendarMaintenance } from "@/components/GoogleCalendarMaintenance";
import { EmailSummarySettings } from "@/components/EmailSummarySettings";
import { EventCategorySettings } from "@/components/EventCategorySettings";
import { FamilyMemberSettings } from "@/components/FamilyMemberSettings";
import { HouseholdAccess } from "@/components/HouseholdAccess";
import { BabysitterShiftSettings } from "@/components/BabysitterShiftSettings";
import { SettingsSection } from "@/components/SettingsSection";
import { SignOutButton } from "@/components/SignOutButton";
import { TimesheetSettings } from "@/components/TimesheetSettings";
import { WeekStartSetting } from "@/components/WeekStartSetting";
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
  validateSearch: (search: Record<string, unknown>): { timesheet?: string } =>
    typeof search["timesheet"] === "string" ? { timesheet: search["timesheet"] } : {},
  // Older owner emails linked here; review now lives in Activities.
  beforeLoad: ({ search }) => {
    if (search.timesheet) throw redirect({ to: "/activities", search: { tab: "timesheets", timesheet: search.timesheet } });
  },
  component: FamilyPageRoute,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner · full access",
  editor: "Editor · can add and edit",
  viewer: "Viewer · view only",
};

function FamilyPageRoute() {
  return (
    <ParentOnly>
      <FamilyPage />
    </ParentOnly>
  );
}

function FamilyPage() {
  const { family, role, isOwner } = useCalendar();


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
          <HouseholdAccess />
          <BabysitterShiftSettings />
        </SettingsSection>

        {isOwner ? (
          <SettingsSection
            title="Timesheets"
            description="Pay periods and timesheet emails"
            icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          >
            <TimesheetSettings />
          </SettingsSection>
        ) : null}



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
          <ChangePasswordDialog />
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
              <BuildDiagnostics />
              <CaregiverVisibilityDiagnostic />
              <DeveloperTools />
            </GoogleCalendarMaintenance>
          </SettingsSection>
        </section>

        <section className="space-y-3 border-t border-border-soft pt-5" aria-label="Account security">
          <SignOutButton />
          <p className="text-center text-xs text-muted-foreground">
            Signs out this device only. Your other devices stay signed in.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Need help?{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
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

