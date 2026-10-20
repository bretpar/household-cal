import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OwnerTimesheets, usePendingTimesheetCount } from "@/components/TimesheetSettings";
import { hasFeature } from "@/lib/features";
import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, ClipboardCheck, Info, Pencil, Repeat, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ParentOnly } from "@/components/CaregiverGate";
import { AddEventDialog } from "@/components/AddEventDialog";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import { eventAccentClass } from "@/lib/event-colors";
import { buildSeriesList, frequencyLabel, type EventSeries } from "@/lib/activity-library";
import { WEEKDAY_CODES, expandOccurrences, type Occurrence } from "@/lib/family-data";

export const Route = createFileRoute("/_authenticated/activities")({
  head: () => ({
    meta: [
      { title: "Activities — Family Calendar" },
      {
        name: "description",
        content: "Every repeating event in your household: sports, lessons, school and work.",
      },
      { property: "og:title", content: "Activities — Family Calendar" },
      {
        property: "og:description",
        content: "Every recurring event, who it belongs to, and when it happens.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "timesheets" | "recurring"; timesheet?: string } => ({
    ...(search["tab"] === "timesheets" || search["tab"] === "recurring"
      ? { tab: search["tab"] as "timesheets" | "recurring" }
      : {}),
    ...(typeof search["timesheet"] === "string" ? { timesheet: search["timesheet"] } : {}),
  }),
  component: ActivitiesPageRoute,
});

function ActivitiesPageRoute() {
  return (
    <ParentOnly>
      <ActivitiesPage />
    </ParentOnly>
  );
}

function ActivitiesPage() {
  const { isOwner, family } = useCalendar();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/activities" });
  const showTimesheets = isOwner && hasFeature("timesheets", { familyId: family?.id });
  const pending = usePendingTimesheetCount(showTimesheets);
  const tab: "hub" | "timesheets" | "recurring" = !showTimesheets
    ? "recurring"
    : search.tab === "timesheets" || search.timesheet
      ? "timesheets"
      : search.tab === "recurring"
        ? "recurring"
        : "hub";
  const goto = (t: "hub" | "timesheets" | "recurring") =>
    void navigate({ search: t === "hub" ? {} : { tab: t } });
  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex items-center gap-2">
          {tab !== "hub" && showTimesheets ? (
            <button
              type="button"
              aria-label="Back to Activities"
              onClick={() => goto("hub")}
              className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">
              {tab === "timesheets" ? "Timesheets" : tab === "recurring" ? "Recurring Activities" : "Activities"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "timesheets"
                ? "Review caregiver timesheets."
                : tab === "recurring"
                  ? "Repeating events on the family calendar."
                  : "Family schedules & more."}
            </p>
          </div>
        </header>
        {tab === "hub" ? (
          <div className="space-y-5">
            <Button
              type="button"
              variant="secondary"
              data-tour-target="activities-timesheets"
              onClick={() => goto("timesheets")}
              className="flex h-auto w-full justify-start gap-3 whitespace-normal rounded-xl border border-border-soft p-3.5 text-left shadow-soft"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-base font-bold">
                  Timesheets
                  {pending > 0 ? (
                    <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{pending}</span>
                  ) : null}
                </span>
                <span className="block text-sm text-muted-foreground">Caregiver hours & approvals</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
            <section aria-labelledby="family-tools-heading" className="space-y-2">
              <h2 id="family-tools-heading" className="text-sm font-bold text-muted-foreground">Family Tools</h2>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  data-tour-target="activities-recurring"
                  onClick={() => goto("recurring")}
                  className="flex h-auto min-h-28 min-w-0 flex-col items-start justify-start gap-2 whitespace-normal rounded-xl border border-border-soft bg-card p-3.5 text-left"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                    <Repeat className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">Recurring Activities</span>
                    <span className="block text-xs text-muted-foreground">Manage schedules</span>
                  </span>
                </Button>
              </div>
            </section>
          </div>
        ) : tab === "timesheets" ? (
          <OwnerTimesheets />
        ) : (
          <RecurringActivities />
        )}
      </div>
    </AppShell>
  );
}

type StatusFilter = "active" | "ended" | "all";

/** Imported recurring work events stay out of the default list; they remain under "All". */
function isImportedWork(series: EventSeries) {
  return series.event.event_type === "work" && Boolean(series.event.external_event_id);
}

function RecurringActivities() {
  const { events, loading, canEdit, sources } = useCalendar();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");

  const series = useMemo(() => buildSeriesList(events), [events]);
  const sourceName = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.name])) as Record<string, string>,
    [sources],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return series
      .filter((s) =>
        status === "all" ? true : status === "active" ? !s.ended && !isImportedWork(s) : s.ended && !isImportedWork(s),
      )
      .filter((s) => !q || s.event.title.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.nextOccurrence && b.nextOccurrence) return a.nextOccurrence.getTime() - b.nextOccurrence.getTime();
        if (a.nextOccurrence) return -1;
        if (b.nextOccurrence) return 1;
        return a.event.title.localeCompare(b.event.title);
      });
  }, [series, status, query]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border-soft bg-card p-1" role="tablist">
        {(["active", "ended", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={status === f}
            onClick={() => setStatus(f)}
            className={cn(
              "h-9 rounded-xl text-sm font-semibold capitalize text-muted-foreground",
              status === f && "bg-secondary text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          aria-label="Search activities"
          placeholder="Search activities"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 w-full rounded-xl border border-border-soft bg-card pl-9 pr-3 text-base sm:text-sm"
        />
      </div>

      {!loading && visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
          <p className="text-base font-bold">
            {query ? "No matching activities" : status === "ended" ? "No ended activities" : "No repeating events yet"}
          </p>
          {!query && status !== "ended" ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {canEdit
                  ? "Add an event with a repeat and it will show up here."
                  : "Recurring commitments will appear here once they are added."}
              </p>
              {canEdit ? (
                <div className="mt-4 flex justify-center">
                  <AddEventDialog />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((item) => (
          <SeriesCard
            key={item.event.id}
            series={item}
            calendarName={item.event.calendar_source_id ? sourceName[item.event.calendar_source_id] ?? null : null}
          />
        ))}
      </div>
    </div>
  );
}

/** Occurrence handed to the shared event editor: the next one, or the series' first for ended series. */
function occurrenceForSeries(series: EventSeries): Occurrence {
  const { event } = series;
  if (series.nextOccurrence) {
    const from = series.nextOccurrence;
    const found = expandOccurrences([event], from, addDays(from, 1))[0];
    if (found) return found;
  }
  const first = expandOccurrences([event], new Date(event.start_at), addDays(new Date(event.start_at), 1))[0];
  return (
    first ?? {
      key: `${event.id}:${event.start_at}`,
      event,
      start: new Date(event.start_at),
      end: new Date(event.end_at),
      member_ids: [...event.member_ids],
    }
  );
}

function SeriesCard({ series, calendarName }: { series: EventSeries; calendarName: string | null }) {
  const { categoryAppearanceFor, canEdit, openOccurrence } = useCalendar();
  const { event } = series;
  const appearance = categoryAppearanceFor(event);
  const editable = canEdit && event.read_only !== true;
  const summary = [
    frequencyLabel(event),
    series.weekdays.length > 0
      ? series.weekdays.map((code) => WEEKDAY_CODES.find((d) => d.code === code)?.short ?? code).join(", ")
      : null,
    event.all_day ? "All day" : format(new Date(event.start_at), "h:mm a"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border-soft bg-card py-3 pl-4 pr-3",
        series.ended && "opacity-75",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", eventAccentClass(appearance))} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold">{event.title}</h3>
        <p className="truncate text-xs text-muted-foreground">{summary}</p>
        <p className="truncate text-xs text-muted-foreground">
          {calendarName ?? appearance.label}
          {series.ended
            ? " · Ended"
            : series.nextOccurrence
              ? ` · Next ${format(series.nextOccurrence, "EEE MMM d")}`
              : ""}
          {event.read_only ? " · Read-only" : ""}
        </p>
      </div>
      <MemberBadgeRow ids={event.member_ids} size="sm" />
      <button
        type="button"
        onClick={() => openOccurrence(occurrenceForSeries(series))}
        className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-bold"
      >
        {editable ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <Info className="h-3.5 w-3.5" aria-hidden />}
        {editable ? "Edit" : "Details"}
      </button>
    </article>
  );
}
