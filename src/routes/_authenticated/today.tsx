import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { AgendaView } from "@/components/AgendaView";
import { CategoryFilter } from "@/components/CategoryFilter";
import { MemberFilter } from "@/components/MemberFilter";
import { useCalendar } from "@/lib/calendar-store";
import { isCoverage, occurrencesForDay } from "@/lib/family-data";

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
  const { events, visibleEvents, selectedMembers, sources, canEdit, copiedEvent, startPaste } = useCalendar();
  const today = new Date();
  const coverage = occurrencesForDay(events, today).filter((o) => isCoverage(o.event));
  const coverageName =
    sources.find((s) => s.display_mode === "coverage_background")?.name ?? "Coverage";

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

        {coverage.length > 0 ? (
          <p className="rounded-2xl bg-coverage-strong/70 px-4 py-3 text-sm font-semibold text-coverage-foreground">
            {coverageName} today ·{" "}
            {coverage
              .map((o) => `${format(o.start, "h:mm a")}–${format(o.end, "h:mm a")}`)
              .join(", ")}
          </p>
        ) : null}


        <MemberFilter />
        <CategoryFilter />
        <AgendaView
          anchor={today}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          days={3}
          onPaste={canEdit && copiedEvent ? startPaste : undefined}
        />
      </div>
    </AppShell>
  );
}
