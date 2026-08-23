import { createFileRoute } from "@tanstack/react-router";
import { Eye, Settings, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { MemberBadge } from "@/components/MemberBadge";
import { Switch } from "@/components/ui/switch";
import { CALENDAR_SOURCES, CAREGIVERS, FAMILY_MEMBERS } from "@/lib/family-data";

export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "Family & Settings — Parker Family Calendar" },
      {
        name: "description",
        content:
          "Parker family members, colors, roles, caregiver access and calendar settings in one place.",
      },
      { property: "og:title", content: "Family & Settings — Parker Family Calendar" },
      {
        property: "og:description",
        content: "Manage who is on the calendar, their colors and their access level.",
      },
    ],
  }),
  component: FamilyPage,
});

function FamilyPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Family</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone on the calendar, their color and what they can do.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
            Members
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {FAMILY_MEMBERS.map((member) => (
              <article
                key={member.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-border-soft bg-card p-4 shadow-soft"
              >
                <MemberBadge id={member.id} size="lg" />
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold">{member.name}</h3>
                  <p className="text-xs font-semibold text-muted-foreground capitalize">
                    {member.role}
                  </p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
                  {member.access === "full" ? (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {member.access === "full" ? "Full access" : "View only"}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">
            Caregivers
          </h2>
          {CAREGIVERS.map((caregiver) => (
            <article
              key={caregiver.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border border-dashed border-border bg-coverage/60 p-4"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-coverage-strong text-sm font-bold text-coverage-foreground">
                BS
              </span>
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

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </h2>
          <div className="divide-y divide-border-soft overflow-hidden rounded-3xl border border-border-soft bg-card">
            {CALENDAR_SOURCES.map((source) => (
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
                    · Google sync coming soon
                  </p>
                </div>
                <Switch defaultChecked aria-label={`Show ${source.name}`} />
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
      </div>
    </AppShell>
  );
}
