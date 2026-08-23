import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, MapPin, Repeat } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { SAMPLE_ACTIVITIES, getMember } from "@/lib/family-data";

export const Route = createFileRoute("/activities")({
  head: () => ({
    meta: [
      { title: "Activities — Parker Family Calendar" },
      {
        name: "description",
        content: "Recurring Parker family activities like soccer, dance and school schedules.",
      },
      { property: "og:title", content: "Activities — Parker Family Calendar" },
      {
        property: "og:description",
        content: "Every recurring activity, who it belongs to, and when it happens.",
      },
    ],
  }),
  component: ActivitiesPage,
});

function ActivitiesPage() {
  return (
    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Activities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recurring commitments that shape the family week.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          {SAMPLE_ACTIVITIES.map((activity) => (
            <article
              key={activity.id}
              className="rounded-3xl border border-border-soft bg-card p-4 shadow-soft"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <h2 className="truncate text-base font-bold">{activity.name}</h2>
                <MemberBadgeRow ids={activity.member_ids} size="sm" />
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {activity.member_ids.map((id) => getMember(id).name).join(", ")}
              </p>
              <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                  <dd>{activity.schedule_label}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                  <dd className="truncate">{activity.location}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 shrink-0" aria-hidden />
                  <dd>{activity.active ? "Active recurring schedule" : "Paused"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
