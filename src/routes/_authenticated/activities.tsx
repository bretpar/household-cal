import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, MapPin, Repeat } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { useCalendar } from "@/lib/calendar-store";


export const Route = createFileRoute("/_authenticated/activities")({
  head: () => ({
    meta: [
      { title: "Activities — Family Calendar" },
      {
        name: "description",
        content: "Recurring household activities like sports, lessons and school schedules.",
      },
      { property: "og:title", content: "Activities — Family Calendar" },
      {
        property: "og:description",
        content: "Every recurring activity, who it belongs to, and when it happens.",
      },
    ],
  }),
  component: ActivitiesPage,
});

function ActivitiesPage() {
  const { activities, memberById, loading } = useCalendar();

  return (
    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Activities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recurring commitments that shape the family week.
          </p>
        </header>

        {!loading && activities.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
            <p className="text-base font-bold">No activities yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit
                ? "Add a repeating event on the calendar and it will show up here."
                : "Recurring commitments will appear here once they are added."}
            </p>
            {canEdit ? (
              <div className="mt-4 flex justify-center">
                <AddEventDialog />
              </div>
            ) : null}
          </div>
        ) : null}


        <div className="grid gap-3 sm:grid-cols-2">
          {activities.map((activity) => (
            <article
              key={activity.id}
              className="rounded-3xl border border-border-soft bg-card p-4 shadow-soft"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <h2 className="truncate text-base font-bold">{activity.name}</h2>
                <MemberBadgeRow ids={activity.member_ids} size="sm" />
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {activity.member_ids
                  .map((id) => memberById[id]?.name)
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {activity.schedule_label ? (
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                    <dd>{activity.schedule_label}</dd>
                  </div>
                ) : null}
                {activity.location ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                    <dd className="truncate">{activity.location}</dd>
                  </div>
                ) : null}
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
