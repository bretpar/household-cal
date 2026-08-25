import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { addDays, addMonths, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { AgendaView } from "@/components/AgendaView";
import { CategoryFilter } from "@/components/CategoryFilter";
import { MemberFilter } from "@/components/MemberFilter";
import { MonthView } from "@/components/MonthView";
import { WeekView } from "@/components/WeekView";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCalendar } from "@/lib/calendar-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Family Calendar" },
      {
        name: "description",
        content:
          "Month, week and agenda views of your household schedule with per-person filters and caregiver coverage.",
      },
      { property: "og:title", content: "Calendar — Family Calendar" },
      {
        property: "og:description",
        content: "One shared calendar for school, activities, work and childcare.",
      },
    ],
  }),
  component: CalendarPage,
});

type ViewMode = "month" | "week" | "agenda";

function CalendarPage() {
  const { events, visibleEvents, selectedMembers, canEdit, loading, copiedEvent, startPaste } = useCalendar();
  const onPaste = canEdit && copiedEvent ? startPaste : undefined;
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const mode: ViewMode = isMobile && view === "month" ? view : view;
  const isEmpty = !loading && events.length === 0;


  const step = (direction: number) =>
    setAnchor((prev) =>
      mode === "month" ? addMonths(prev, direction) : addDays(prev, direction * (mode === "week" ? 7 : 1)),
    );

  const label =
    mode === "month"
      ? format(anchor, "MMMM yyyy")
      : mode === "week"
        ? `${format(startOfWeek(anchor, { weekStartsOn: 1 }), "MMM d")} – ${format(addDays(startOfWeek(anchor, { weekStartsOn: 1 }), 6), "MMM d")}`
        : format(anchor, "EEEE, MMM d");

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <h1 className="truncate text-2xl font-bold sm:text-3xl">Calendar</h1>
          <AddEventDialog defaultDate={anchor} />
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              aria-label="Previous"
              onClick={() => step(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-0 truncate text-base font-bold sm:text-lg">{label}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              aria-label="Next"
              onClick={() => step(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="ml-1 h-9 rounded-full px-3 text-xs font-bold"
              onClick={() => setAnchor(new Date())}
            >
              Today
            </Button>
          </div>

          <div className="flex rounded-full bg-surface-muted p-1">
            {(["month", "week", "agenda"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "h-9 rounded-full px-4 text-sm font-semibold capitalize transition-colors",
                  view === v ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground",
                )}
              >
                {v === "agenda" ? "Today" : v}
              </button>
            ))}
          </div>
        </div>
        {isEmpty ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
            <p className="text-base font-bold">No events yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit
                ? "Add your first event and it will appear across every view."
                : "Events shared with your household will show up here."}
            </p>
            {canEdit ? (
              <div className="mt-4 flex justify-center">
                <AddEventDialog defaultDate={anchor} />
              </div>
            ) : null}
          </div>
        ) : null}


        <MemberFilter />
        <CategoryFilter />

        {mode === "month" ? (
          <MonthView
            month={anchor}
            events={visibleEvents}
            selectedMembers={selectedMembers}
            onPaste={onPaste}
            onSelectDay={(day) => {
              setAnchor(day);
              setView("agenda");
            }}
          />
        ) : mode === "week" ? (
          <WeekView
            anchor={anchor}
            events={visibleEvents}
            selectedMembers={selectedMembers}
            days={isMobile ? 3 : 7}
          />
        ) : (
          <div className="space-y-4">
            <WeekView anchor={anchor} events={visibleEvents} selectedMembers={selectedMembers} days={1} />
            <AgendaView
              anchor={anchor}
              events={visibleEvents}
              selectedMembers={selectedMembers}
              onPaste={onPaste}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
