import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { addDays, format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { AgendaView } from "@/components/AgendaView";

import { PeopleFilterButton } from "@/components/MemberFilter";
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
  const { visibleEvents, selectedMembers, canEdit, copiedEvent, startPaste, loading, loadError, setVisibleRange, cachedAt, refreshFailed } =
    useCalendar();
  // Re-check the date every minute so the window rolls forward past midnight.
  const [dayStamp, setDayStamp] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = window.setInterval(() => setDayStamp(new Date().toDateString()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = new Date();

  // Today ±2 days: the same window the calendar store persists.
  useEffect(() => {
    const now = new Date();
    setVisibleRange(addDays(now, -2), addDays(now, 3));
  }, [setVisibleRange, dayStamp]);

  return (
    <AppShell>
      <div className="space-y-3">
        <header className="space-y-3">
          <div>
            <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {format(today, "EEEE")}
            </p>
            <h1 className="text-2xl font-bold sm:text-3xl">{format(today, "MMMM d")}</h1>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <PeopleFilterButton />
            </div>
            <AddEventDialog defaultDate={today} />
          </div>
        </header>
        {(cachedAt || refreshFailed) && (
          <p role="status" className="text-xs text-muted-foreground">
            {refreshFailed
              ? "Couldn't refresh — showing the last loaded events."
              : `Updating… last updated ${format(cachedAt!, "h:mm a")}`}
          </p>
        )}
        <div data-tour-target="today-agenda">
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
      </div>
    </AppShell>
  );
}
