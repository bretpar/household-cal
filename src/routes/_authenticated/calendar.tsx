import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { addDays, addMonths, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { AgendaView } from "@/components/AgendaView";
import { CalendarFiltersSheet } from "@/components/CalendarFiltersSheet";
import { MonthView } from "@/components/MonthView";
import { QuickAddEventDialog } from "@/components/QuickAddEventDialog";
import { WeekView } from "@/components/WeekView";
import { Button } from "@/components/ui/button";
import { usePeriodCarousel } from "@/hooks/use-period-carousel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCalendar } from "@/lib/calendar-store";
import {
  CALENDAR_VIEW_LABEL,
  useDefaultCalendarView,
  type CalendarViewMode,
} from "@/lib/calendar-view-preference";
import { useWeekStart } from "@/lib/week-start-preference";
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

type ViewMode = CalendarViewMode;

function CalendarPage() {
  const { events, visibleEvents, selectedMembers, canEdit, loading, copiedEvent, startPaste, family } =
    useCalendar();
  const onPaste = canEdit && copiedEvent ? startPaste : undefined;
  // Press-and-hold creation on touch devices; the Add Event button stays the fallback.
  const [quickAdd, setQuickAdd] = useState<{
    at: Date;
    until?: Date | null;
    withTime: boolean;
  } | null>(null);
  const onCreateAt = canEdit
    ? (at: Date, withTime: boolean) => setQuickAdd({ at, withTime })
    : undefined;
  // Week/Day gestures propose a full time range from the dragged preview block.
  const onCreateRange = canEdit
    ? (at: Date, until: Date) => setQuickAdd({ at, until, withTime: true })
    : undefined;
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const { defaultView } = useDefaultCalendarView(family?.id ?? null);
  const { weekStart } = useWeekStart(family?.id ?? null);
  const [appliedDefault, setAppliedDefault] = useState(false);

  // Open on the user's saved default view once, without fighting later manual changes.
  useEffect(() => {
    if (appliedDefault || !defaultView) return;
    setView(defaultView);
    setAppliedDefault(true);
  }, [defaultView, appliedDefault]);

  const mode: ViewMode = view;
  const isEmpty = !loading && events.length === 0;

  // Week view is a 7-day calendar where there is room, and a 3-day calendar on
  // phones so each column is wide enough to read.
  const weekDays = isMobile ? 3 : 7;

  // Arrows / swipes advance exactly one unit of the current view.
  const shift = (from: Date, direction: number) => {
    if (mode === "month") return addMonths(from, direction);
    if (mode === "week") return addDays(from, weekDays * direction);
    return addDays(from, direction);
  };

  // Subtle tap on any period change; focus returns to the period region so
  // keyboard and screen-reader users land on the newly active date range.
  const periodRef = useRef<HTMLDivElement | null>(null);
  const haptic = () => navigator.vibrate?.(10);
  const focusPeriod = () => {
    requestAnimationFrame(() => periodRef.current?.focus({ preventScroll: true }));
  };

  // Finger-following paging: the track moves with the drag and snaps on release.
  const carousel = usePeriodCarousel({
    sensitivity: mode,
    onNavigate: haptic,
    onCommit: (direction) => setAnchor((prev) => shift(prev, direction)),
  });

  const step = (direction: 1 | -1, { focus = false }: { focus?: boolean } = {}) => {
    if (carousel.busy) return;
    if (focus) focusPeriod();
    carousel.commit(direction);
  };

  const goToday = () => {
    if (carousel.busy) return;
    haptic();
    focusPeriod();
    setAnchor(new Date());
  };

  // Desktop/tablet Week snaps to the containing 7-day week; the phone 3-day
  // view starts on the anchored date itself.
  const weekAnchorFor = (at: Date) =>
    isMobile ? at : startOfWeek(at, { weekStartsOn: weekStart });

  const labelFor = (at: Date) => {
    if (mode === "month") return format(at, "MMMM yyyy");
    if (mode !== "week") return format(at, "EEEE, MMM d");
    const from = weekAnchorFor(at);
    const to = addDays(from, weekDays - 1);
    return `${format(from, "MMM d")} – ${format(to, "MMM d")}`;
  };
  const label = labelFor(anchor);

  const viewLabel = (v: ViewMode) =>
    v === "week" && isMobile ? "3 Day" : CALENDAR_VIEW_LABEL[v];

  const renderPeriod = (at: Date) =>
    mode === "month" ? (
      <MonthView
        month={at}
        events={visibleEvents}
        selectedMembers={selectedMembers}
        onPaste={onPaste}
        onCreateAt={onCreateAt}
        weekStartsOn={weekStart}
        bare
        fill={isMobile}
        onSelectDay={(day) => {
          setAnchor(day);
          setView("day");
        }}
      />
    ) : mode === "week" ? (
      <WeekView
        anchor={weekAnchorFor(at)}
        events={visibleEvents}
        selectedMembers={selectedMembers}
        days={weekDays}
        onCreateRange={onCreateRange}
        bare
        fill={isMobile}
      />
    ) : isMobile ? (
      // Phone day view: only the hourly timeline scrolls, the page stays put.
      <WeekView
        anchor={at}
        events={visibleEvents}
        selectedMembers={selectedMembers}
        days={1}
        onCreateRange={onCreateRange}
        bare
        fill
      />
    ) : (
      <div>
        <WeekView
          anchor={at}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          days={1}
          onCreateRange={onCreateRange}
          bare
        />
        <div className="border-t border-border-soft p-4">
        <AgendaView
          anchor={at}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          onPaste={onPaste}
        />
        </div>
      </div>
    );

  // Neighbours mount only while a gesture/transition is in flight so idle
  // rendering cost stays the same as before.
  const showNeighbours = carousel.dragging || carousel.animating;
  const trackStyle = {
    transform: `translate3d(${carousel.offset}px, 0, 0)`,
    transition: carousel.dragging
      ? "none"
      : `transform ${carousel.duration}ms cubic-bezier(0.32, 0.72, 0, 1)`,
  } as const;



  return (
    <AppShell fitViewport>
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:block md:space-y-4">
        {/* Desktop / tablet header — unchanged */}
        <header className="hidden grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid">
          <h1 className="truncate text-2xl font-bold sm:text-3xl">Calendar</h1>
          <AddEventDialog defaultDate={anchor} />
        </header>

        {/* Compact phone toolbar: navigation, Today and + on one row. */}
        <div className="flex shrink-0 items-center gap-1 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label={`Previous ${viewLabel(mode).toLowerCase()}`}
            onClick={() => step(-1, { focus: true })}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-center text-sm font-bold">{label}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label={`Next ${viewLabel(mode).toLowerCase()}`}
            onClick={() => step(1, { focus: true })}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            className="h-9 shrink-0 rounded-full px-2.5 text-xs font-bold"
            onClick={goToday}
          >
            Today
          </Button>
          <AddEventDialog defaultDate={anchor} compact />
        </div>

        <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              aria-label={`Previous ${viewLabel(mode).toLowerCase()}`}
              onClick={() => step(-1, { focus: true })}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            {/* The header stays put: only the grid content animates. */}
            <span className="min-w-0 flex-1 truncate text-base font-bold sm:text-lg">
              {label}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full"
              aria-label={`Next ${viewLabel(mode).toLowerCase()}`}
              onClick={() => step(1, { focus: true })}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="ml-1 h-9 rounded-full px-3 text-xs font-bold"
              onClick={goToday}
            >
              Today
            </Button>

          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-surface-muted p-1">
              {(["month", "week", "day"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "h-9 rounded-full px-3.5 text-sm font-semibold transition-colors sm:px-4",
                    view === v ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground",
                  )}
                >
                  {viewLabel(v)}
                </button>
              ))}
            </div>
            <CalendarFiltersSheet />
          </div>
        </div>

        {/* Phone view switcher + filters */}
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <div className="flex min-w-0 flex-1 rounded-full bg-surface-muted p-1">
            {(["month", "week", "day"] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "h-8 flex-1 rounded-full text-xs font-semibold transition-colors",
                  view === v ? "bg-surface text-foreground shadow-soft" : "text-muted-foreground",
                )}
              >
                {viewLabel(v)}
              </button>
            ))}
          </div>
          <CalendarFiltersSheet />
        </div>

        {isEmpty ? (
          <div className="hidden rounded-3xl border border-dashed border-border bg-surface p-6 text-center md:block">
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

        {/* Announces the newly active period to screen readers on navigation. */}
        <p aria-live="polite" className="sr-only">
          {label}
        </p>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border-soft bg-surface shadow-soft md:block">
        <div
          ref={carousel.containerRef}
          className="relative flex min-h-0 flex-1 flex-col touch-pan-y overflow-hidden md:block"
        >
          <div
            className="relative flex min-h-0 flex-1 flex-col will-change-transform md:block"
            style={trackStyle}
          >
            {showNeighbours ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-full flex w-full flex-col overflow-hidden md:block"
              >
                {renderPeriod(shift(anchor, -1))}
              </div>
            ) : null}
            <div
              ref={periodRef}
              tabIndex={-1}
              role="group"
              aria-label={`${viewLabel(mode)} view: ${label}`}
              className="flex min-h-0 flex-1 flex-col outline-none md:block"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  step(-1, { focus: true });
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  step(1, { focus: true });
                }
              }}
            >
              {renderPeriod(anchor)}
            </div>
            {showNeighbours ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-full flex w-full flex-col overflow-hidden md:block"
              >
                {renderPeriod(shift(anchor, 1))}
              </div>
            ) : null}
          </div>
        </div>
        </div>



      </div>

      <QuickAddEventDialog
        at={quickAdd?.at ?? null}
        until={quickAdd?.until ?? null}
        withTime={quickAdd?.withTime ?? false}
        onClose={() => setQuickAdd(null)}
      />
    </AppShell>
  );
}
