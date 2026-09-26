import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { AgendaView } from "@/components/AgendaView";

import { MemberFilter } from "@/components/MemberFilter";
import { useCalendar } from "@/lib/calendar-store";

export const Route = createFileRoute("/_authenticated/today")({
  head: () => ({
    meta: [
      { title: "Today — Family Calendar" },
      {
        name: "description",
        content:
          "See what everyone in your household is doing today, including caregiver coverage.",
      },
      { property: "og:title", content: "Today — Family Calendar" },
      {
        property: "og:description",
        content: "A warm, shared household calendar for school, activities and childcare.",
      },
    ],
  }),
  component: TodayPage,
});

function TodayPage() {
  const { visibleEvents, selectedMembers, canEdit, copiedEvent, startPaste, loading, loadError } =
    useCalendar();
  const today = new Date();

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {format(today, "EEEE")}
            </p>
            <h1 className="truncate text-2xl font-bold sm:text-3xl">
              {format(today, "MMMM d, yyyy")}
            </h1>
          </div>
          <AddEventDialog defaultDate={today} />
        </header>

        <MemberFilter />
        <AgendaView
          anchor={today}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          days={3}
          loading={loading}
          loadError={loadError}
          onPaste={canEdit && copiedEvent ? startPaste : undefined}
        />
      </div>
    </AppShell>
  );
}
