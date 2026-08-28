import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, Clock, MapPin, Repeat } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AddEventDialog } from "@/components/AddEventDialog";
import { MemberBadge, MemberBadgeRow } from "@/components/MemberBadge";
import { eventTypeIcons } from "@/components/EventCard";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";
import { eventAccentClass } from "@/lib/event-colors";
import {
  GROUP_MODES,
  SORT_MODES,
  buildSeriesList,
  durationLabel,
  frequencyLabel,
  groupSeries,
  type EventSeries,
  type GroupMode,
  type SortMode,
} from "@/lib/activity-library";
import { activityLabel, WEEKDAY_CODES, describeWeekdays, formatTimeRange } from "@/lib/family-data";

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
  component: ActivitiesPage,
});

function ActivitiesPage() {
  const { events, members, loading, canEdit, categories } = useCalendar();
  const [group, setGroup] = useState<GroupMode>("category");
  const [sort, setSort] = useState<SortMode>("next");

  const series = useMemo(() => buildSeriesList(events), [events]);
  const groups = useMemo(
    () => groupSeries(series, group, sort, members, categories),
    [series, group, sort, members, categories],
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-bold sm:text-3xl">Activities</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every repeating event on the family calendar.
          </p>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Picker
            label="Group by"
            value={group}
            options={GROUP_MODES}
            onChange={(v) => setGroup(v as GroupMode)}
          />
          <Picker
            label="Sort by"
            value={sort}
            options={SORT_MODES}
            onChange={(v) => setSort(v as SortMode)}
          />
        </div>

        {!loading && series.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface p-6 text-center">
            <p className="text-base font-bold">No repeating events yet</p>
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
          </div>
        ) : null}

        {groups.map((section) => (
          <section key={section.key} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-bold">{section.label}</h2>
              <span className="text-xs font-semibold text-muted-foreground">
                {section.items.length}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {section.items.map((item) => (
                <SeriesCard key={`${section.key}-${item.event.id}`} series={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `activities-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <label htmlFor={id} className="block text-xs font-bold text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-border-soft bg-card px-3 text-sm font-semibold"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SeriesCard({ series }: { series: EventSeries }) {
  const { categoryAppearanceFor, memberById } = useCalendar();
  const { event } = series;
  const Icon = eventTypeIcons[event.event_type];
  const typeLabel = activityLabel(event.event_type);
  const appearance = categoryAppearanceFor(event.category_id);
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border-soft bg-card p-4 shadow-soft",
        series.ended && "opacity-75",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1.5",
          eventAccentClass(appearance),
        )}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pl-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <h3 className="truncate text-base font-bold">{event.title}</h3>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", appearance.swatch)}
              aria-hidden
            />
            {appearance.label} · {typeLabel}
          </p>
        </div>
        <MemberBadgeRow ids={event.member_ids} size="sm" />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 pl-2">
        {series.ended ? (
          <Chip tone="muted">Ended</Chip>
        ) : (
          <Chip tone="active">Active</Chip>
        )}
        {event.needs_family_assignment ? <Chip tone="muted">Needs family assignment</Chip> : null}
        {event.external_event_id ? <Chip tone="muted">From Google</Chip> : null}
      </div>

      <dl className="mt-3 space-y-1.5 pl-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 shrink-0" aria-hidden />
          <dd>
            {frequencyLabel(event)}
            {series.weekdays.length > 0
              ? ` · ${series.weekdays
                  .map((code) => WEEKDAY_CODES.find((d) => d.code === code)?.short ?? code)
                  .join(", ")}`
              : ""}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <dd>
            {formatTimeRange(start, end, event.all_day)}
            {event.all_day ? "" : ` · ${durationLabel(series.durationMinutes)}`}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
          <dd>
            {series.nextOccurrence
              ? `Next: ${format(series.nextOccurrence, "EEE MMM d")}`
              : `Ran from ${format(start, "MMM d, yyyy")}`}
          </dd>
        </div>
        {event.location ? (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            <dd className="truncate">{event.location}</dd>
          </div>
        ) : null}
      </dl>

      {series.perPersonDays.length > 0 ? (
        <div className="mt-3 ml-2 space-y-1 rounded-xl bg-surface-muted px-3 py-2 text-xs">
          <span className="font-bold">Days by person</span>
          {series.perPersonDays.map((row) => (
            <div key={row.member_id} className="flex justify-between gap-3 text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
                <MemberBadge id={row.member_id} size="xs" />
                <span className="truncate">{memberById[row.member_id]?.name ?? "Member"}</span>
              </span>
              <span>{describeWeekdays(row.weekdays)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "active" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
        tone === "active"
          ? "bg-shared-strong text-member-foreground"
          : "bg-surface-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
