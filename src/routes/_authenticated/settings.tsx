import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { CaregiverOnly } from "@/components/CaregiverGate";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";

import { MemberBadge } from "@/components/MemberBadge";
import { SignOutButton } from "@/components/SignOutButton";
import { calendarIconComponent } from "@/lib/calendar-icons";
import { useCalendar } from "@/lib/calendar-store";
import { styleForColor, type MemberColor } from "@/lib/family-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Caregiver Settings — Family Calendar" },
      { name: "description", content: "Your household, family colors and calendars you can view." },
      { property: "og:title", content: "Caregiver Settings — Family Calendar" },
      { property: "og:description", content: "Read-only caregiver settings." },
    ],
  }),
  component: CaregiverSettingsRoute,
});

function CaregiverSettingsRoute() {
  return (
    <CaregiverOnly fallback="/family">
      <CaregiverSettings />
    </CaregiverOnly>
  );
}

function CaregiverSettings() {
  const { family, members, sources } = useCalendar();
  const visibleMembers = members.filter((m) => m.active !== false);
  const visibleSources = sources.filter((s) => s.active && s.calendar_kind !== "legacy_internal");

  return (
    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {family?.name ?? "Your household"} · Caregiver
          </p>
        </header>

        <p className="rounded-2xl border border-dashed border-border bg-surface-muted/50 p-4 text-sm text-muted-foreground">
          Your calendar access and schedule visibility are managed by your family.
        </p>

        <section className="space-y-2">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Family</h2>
          <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
            {visibleMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <MemberBadge id={m.id} />
                <span className="text-sm font-semibold">{m.name}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Calendars</h2>
          <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card">
            {visibleSources.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No calendars shared with you yet.</p>
            ) : (
              visibleSources.map((s) => {
                const Icon = calendarIconComponent(s.display_icon);
                return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={cn("h-5 w-5 shrink-0 rounded-md", styleForColor((s.color ?? "sky") as MemberColor).dot)}
                      aria-hidden
                    />
                    {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> : null}
                    <span className="text-sm font-semibold">{s.name}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-3 border-t border-border-soft pt-5" aria-label="Account">
          <ChangePasswordDialog />
          <SignOutButton />
        </section>

      </div>
    </AppShell>
  );
}
