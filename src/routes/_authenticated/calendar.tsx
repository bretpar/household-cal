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
import { useHorizontalSwipe } from "@/hooks/use-horizontal-swipe";
import { usePeriodSlide } from "@/hooks/use-period-slide";
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

  // Slide the old period out while the new one slides in from the other side.
  const slide = usePeriodSlide<Date>();

  const shift = (from: Date, direction: number) =>
    mode === "month" ? addMonths(from, direction) : addDays(from, direction * (mode === "week" ? 7 : 1));

  // Subtle tap on any period change; focus returns to the period region so
  // keyboard and screen-reader users land on the newly active date range.
  const periodRef = useRef<HTMLDivElement | null>(null);
  const haptic = () => navigator.vibrate?.(10);
  const focusPeriod = () => {
    // Wait for the slide to start so focus lands on the incoming period.
    requestAnimationFrame(() => periodRef.current?.focus({ preventScroll: true }));
  };

  const step = (direction: 1 | -1, { focus = false }: { focus?: boolean } = {}) => {
    if (slide.animating) return;
    haptic();
    if (focus) focusPeriod();
    slide.navigate(anchor, direction, () => setAnchor((prev) => shift(prev, direction)));
  };

  const goToday = () => {
    if (slide.animating) return;
    const today = new Date();
    const direction: 1 | -1 = today >= anchor ? 1 : -1;
    haptic();
    focusPeriod();
    slide.navigate(anchor, direction, () => setAnchor(today));
  };

  // Swipe left = forward, swipe right = back — same state as the arrows.
  const swipeProps = useHorizontalSwipe({
    onSwipeLeft: () => step(1),
    onSwipeRight: () => step(-1),
    sensitivity: mode,
  });

  // Full week columns honor the week-start preference; the 3-day phone layout
  // stays rolling from the anchor so it keeps looking forward from today.
  const weekDays = isMobile ? 3 : 7;
  const weekAnchorFor = (at: Date) =>
    weekDays === 7 ? startOfWeek(at, { weekStartsOn: weekStart }) : at;

  const labelFor = (at: Date) =>
    mode === "month"
      ? format(at, "MMMM yyyy")
      : mode === "week"
        ? `${format(weekAnchorFor(at), "MMM d")} – ${format(addDays(weekAnchorFor(at), weekDays - 1), "MMM d")}`
        : format(at, "EEEE, MMM d");
  const label = labelFor(anchor);

  const renderPeriod = (at: Date) =>
    mode === "month" ? (
      <MonthView
        month={at}
        events={visibleEvents}
        selectedMembers={selectedMembers}
        onPaste={onPaste}
        onCreateAt={onCreateAt}
        weekStartsOn={weekStart}
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
      />
    ) : (
      <div className="space-y-4">
        <WeekView
          anchor={at}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          days={1}
          onCreateRange={onCreateRange}
        />
        <AgendaView
          anchor={at}
          events={visibleEvents}
          selectedMembers={selectedMembers}
          onPaste={onPaste}
        />
      </div>
    );

  const incomingClass = slide.outgoing
    ? slide.outgoing.direction === 1
      ? "cal-slide-in-right"
      : "cal-slide-in-left"
    : undefined;
  const outgoingClass =
    slide.outgoing?.direction === 1 ? "cal-slide-out-left" : "cal-slide-out-right";


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
              aria-label={`Previous ${CALENDAR_VIEW_LABEL[mode].toLowerCase()}`}
              onClick={() => step(-1, { focus: true })}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="relative min-w-0 flex-1 overflow-hidden">
              {slide.outgoing ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 truncate text-base font-bold sm:text-lg",
                    outgoingClass,
                  )}
                >
                  {labelFor(slide.outgoing.value)}
                </span>
              ) : null}
              <span
                className={cn(
                  "block min-w-0 truncate text-base font-bold sm:text-lg",
                  incomingClass,
                )}
              >
                {label}
              </span>
            </span>
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
                  {CALENDAR_VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            <CalendarFiltersSheet />
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

        <div {...swipeProps} className="relative touch-pan-y overflow-hidden">
          {slide.outgoing ? (
            <div
              aria-hidden
              className={cn("pointer-events-none absolute inset-x-0 top-0", outgoingClass)}
            >
              {renderPeriod(slide.outgoing.value)}
            </div>
          ) : null}
          <div className={incomingClass}>{renderPeriod(anchor)}</div>
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
