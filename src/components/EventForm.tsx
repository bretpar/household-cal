import { format } from "date-fns";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EventDraft } from "@/lib/calendar-store";
import type { EventClipboard } from "@/lib/event-clipboard";
import {
  UNCATEGORIZED_APPEARANCE,
  UNCATEGORIZED_LABEL,
  categoryAppearance,
} from "@/lib/event-categories";

/** Select needs a non-empty value for the system Uncategorized state. */
const UNCATEGORIZED_VALUE = "__uncategorized__";
import { useCalendar } from "@/lib/calendar-store";
import {
  EVENT_TYPES,
  RECURRENCE_OPTIONS,
  WEEKDAY_CODES,
  parseRecurrenceRule,
  withRecurrenceCount,
  type CalendarSource,
  type EventType,
  type MemberId,
  type Occurrence,
  type WeekdayCode,
} from "@/lib/family-data";

export type RecurrenceEndMode = "on" | "count" | "never";

export interface EventFormState {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  members: MemberId[];
  eventType: EventType;
  /** household category id, or null for the system Uncategorized state */
  categoryId: string | null;
  recurrence: string;
  /** How the series stops. Defaults to an explicit end date. */
  recurrenceEnd: RecurrenceEndMode;
  /** yyyy-MM-dd, used when recurrenceEnd is "on". */
  recurrenceUntil: string;
  /** Occurrence count, used when recurrenceEnd is "count". */
  recurrenceCount: number;
  /** when on, each selected member gets their own weekdays inside the series */
  customizeDays: boolean;
  /** member id -> weekdays they take part in. Missing/empty = every occurrence. */
  memberWeekdays: Record<MemberId, WeekdayCode[]>;
  location: string;
  notes: string;
  /** Which connected calendar the event lives on. null = the main calendar. */
  calendarSourceId: string | null;
}

/** Sensible default end date: three months of repeats from the event day. */
export function defaultUntil(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  base.setMonth(base.getMonth() + 3);
  return format(base, "yyyy-MM-dd");
}

export function emptyFormState(defaultDate?: Date): EventFormState {
  const date = format(defaultDate ?? new Date(), "yyyy-MM-dd");
  return {
    title: "",
    date,
    startTime: "16:00",
    endTime: "17:00",
    allDay: false,
    members: [],
    eventType: "activity",
    categoryId: null,
    recurrence: "none",
    recurrenceEnd: "on",
    recurrenceUntil: defaultUntil(date),
    recurrenceCount: 10,
    customizeDays: false,
    memberWeekdays: {},
    location: "",
    notes: "",
    calendarSourceId: null,
  };
}

export function formStateFromOccurrence(occurrence: Occurrence): EventFormState {
  const { event, start, end } = occurrence;
  const baseRule = withRecurrenceCount(event.recurrence_rule, null);
  const match = RECURRENCE_OPTIONS.find((r) => r.rule === baseRule);
  const parsed = parseRecurrenceRule(event.recurrence_rule);
  const date = format(start, "yyyy-MM-dd");
  const memberWeekdays: Record<MemberId, WeekdayCode[]> = {};
  for (const p of event.participants) {
    if (p.weekdays && p.weekdays.length > 0) memberWeekdays[p.member_id] = [...p.weekdays];
  }
  const perPerson = Object.keys(memberWeekdays).length > 0;
  const end_mode: RecurrenceEndMode = event.recurrence_until
    ? "on"
    : parsed?.count
      ? "count"
      : "never";
  return {
    title: event.title,
    date,
    startTime: format(start, "HH:mm"),
    endTime: format(end, "HH:mm"),
    allDay: event.all_day,
    members: [...event.member_ids],
    eventType: event.event_type,
    categoryId: event.category_id ?? null,
    recurrence: match?.id ?? (event.recurrence_rule ? "custom" : "none"),
    recurrenceEnd: end_mode,
    recurrenceUntil: event.recurrence_until ?? defaultUntil(date),
    recurrenceCount: parsed?.count ?? 10,
    customizeDays: perPerson,
    memberWeekdays,
    location: event.location ?? "",
    notes: event.notes ?? "",
    calendarSourceId: event.calendar_source_id ?? null,
  };
}

/** Copied details + the newly chosen day. Never a recurring series by default. */
export function formStateFromClipboard(clip: EventClipboard, date: Date): EventFormState {
  const day = format(date, "yyyy-MM-dd");
  return {
    title: clip.title,
    date: day,
    startTime: clip.startTime,
    endTime: clip.endTime,
    allDay: clip.allDay,
    members: [...clip.members],
    eventType: clip.eventType,
    categoryId: clip.categoryId ?? null,
    recurrence: "none",
    recurrenceEnd: "on",
    recurrenceUntil: defaultUntil(day),
    recurrenceCount: 10,
    customizeDays: false,
    memberWeekdays: {},
    location: clip.location,
    notes: clip.notes,
    calendarSourceId: clip.calendar_source_id ?? null,
  };
}

function combine(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

/** null = every occurrence of the series, so an untouched person keeps the simple behavior. */
function allWeekdays(days: WeekdayCode[] | undefined): WeekdayCode[] | null {
  return days && days.length > 0 ? days : null;
}

const ORDERED_WEEKDAYS = WEEKDAY_CODES.map((w) => w.code);

/** Per-person days are always in play for the Custom schedule. */
export function usesPerPersonDays(state: EventFormState): boolean {
  return state.customizeDays || state.recurrence === "custom";
}

/**
 * The stored RRULE for a form state.
 *
 * "Custom" is a real weekly rule whose BYDAY is the union of the days people
 * were given, so School (B Mon–Thu, E Tue–Thu) stores
 * FREQ=WEEKLY;BYDAY=MO,TU,WE,TH and never the old "CUSTOM" placeholder — that
 * placeholder produced no local occurrences and an invalid Google RRULE.
 */
export function ruleForFormState(state: EventFormState): string | null {
  if (state.recurrence === "custom") {
    const union = new Set<WeekdayCode>();
    for (const id of state.members) {
      for (const day of state.memberWeekdays[id] ?? []) union.add(day);
    }
    const days = ORDERED_WEEKDAYS.filter((d) => union.has(d));
    if (days.length === 0 && state.date) {
      const code = ORDERED_WEEKDAYS[(new Date(`${state.date}T00:00`).getDay() + 6) % 7];
      if (code) days.push(code);
    }
    if (days.length === 0) return null;
    return `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
  }
  const rule = RECURRENCE_OPTIONS.find((r) => r.id === state.recurrence)?.rule ?? null;
  return rule;
}

/**
 * The calendar new events land on when the user never opens the picker.
 * Mirrors exactly what the form shows: the main active Google calendar, else the
 * first active Google calendar, else null (local Family source resolved server-side).
 */
export function defaultCalendarSourceId(
  sources: Pick<CalendarSource, "id" | "provider" | "active" | "is_main">[],
): string | null {
  const google = sources.filter((s) => s.provider === "google" && s.active);
  return google.find((s) => s.is_main)?.id ?? google[0]?.id ?? null;
}

export function draftFromFormState(
  state: EventFormState,
  calendarSourceId: string | null = null,
): EventDraft {
  const baseRule = ruleForFormState(state);
  const repeats = Boolean(baseRule);
  const rule = repeats
    ? withRecurrenceCount(
        baseRule,
        state.recurrenceEnd === "count" ? Math.max(1, Math.floor(state.recurrenceCount)) : null,
      )
    : null;
  return {
    title: state.title.trim(),
    start_at: state.allDay ? combine(state.date, "00:00") : combine(state.date, state.startTime),
    end_at: state.allDay ? combine(state.date, "23:59") : combine(state.date, state.endTime),
    all_day: state.allDay,
    location: state.location.trim() || null,
    notes: state.notes.trim() || null,
    event_type: state.eventType,
    category_id: state.categoryId,
    recurrence_rule: rule,
    recurrence_until:
      repeats && state.recurrenceEnd === "on" ? state.recurrenceUntil || null : null,
    calendar_source_id: state.calendarSourceId ?? calendarSourceId,
    member_ids: state.members,
    member_weekdays:
      repeats && usesPerPersonDays(state)
        ? Object.fromEntries(
            state.members.map((id) => [id, allWeekdays(state.memberWeekdays[id])]),
          )
        : {},
  };
}


export function validateFormState(state: EventFormState): string | null {
  if (!state.title.trim()) return "Please add an event name";
  if (state.members.length === 0) return "Choose at least one family member";
  const repeats =
    state.recurrence === "custom" ||
    (RECURRENCE_OPTIONS.find((r) => r.id === state.recurrence)?.rule ?? null) !== null;
  if (repeats && state.recurrenceEnd === "on") {
    if (!state.recurrenceUntil) return "Choose the date the repeat should end";
    if (state.recurrenceUntil < state.date) return "The repeat end date can't be before the event";
  }
  if (repeats && state.recurrenceEnd === "count" && state.recurrenceCount < 1) {
    return "A repeating event needs at least 1 occurrence";
  }
  if (repeats && usesPerPersonDays(state)) {
    const missing = state.members.filter((id) => (state.memberWeekdays[id] ?? []).length === 0);
    if (missing.length > 0) {
      return "Choose at least one day for each person, or turn off Customize days by person";
    }
  }


  return null;
}


const END_MODES: { id: RecurrenceEndMode; label: string }[] = [
  { id: "on", label: "On date" },
  { id: "count", label: "After occurrences" },
  { id: "never", label: "Never" },
];

/** Shared fields for both the add and edit flows. Large touch targets for iPad/phone. */
export function EventFormFields({
  state,
  onChange,
  idPrefix = "event",
}: {
  state: EventFormState;
  onChange: (next: EventFormState) => void;
  idPrefix?: string;
}) {
  const { members, styleFor, sources, categories } = useCalendar();
  const activeMembers = members.filter((m) => m.active);
  // Only worth showing when there is an actual routing choice to make.
  const syncedCalendars = sources.filter((s) => s.provider === "google" && s.active);
  const shownCalendarSourceId = state.calendarSourceId ?? defaultCalendarSourceId(sources);

  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) =>
    onChange({ ...state, [key]: value });

  const recurrenceOption = RECURRENCE_OPTIONS.find((r) => r.id === state.recurrence);
  const repeats = state.recurrence === "custom" || Boolean(recurrenceOption?.rule);
  const perPersonDays = usesPerPersonDays(state);
  const frequencyLabel = recurrenceOption?.label ?? "";

  const startsLabel = state.date
    ? format(new Date(`${state.date}T00:00`), "EEEE, MMM d, yyyy")
    : "the event date";


  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Event name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={state.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Soccer practice"
          className="h-11 rounded-xl"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={state.date}
          onChange={(e) => {
            const date = e.target.value;
            onChange({
              ...state,
              date,
              recurrenceUntil:
                date && state.recurrenceUntil < date ? defaultUntil(date) : state.recurrenceUntil,
            });
          }}
          className="h-11 rounded-xl"
        />
      </div>

      <div className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2.5">
        <Label htmlFor={`${idPrefix}-all-day`} className="font-semibold">
          All-day event
        </Label>
        <Switch
          id={`${idPrefix}-all-day`}
          checked={state.allDay}
          onCheckedChange={(v) => set("allDay", v)}
        />
      </div>

      {!state.allDay ? (
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-start`}>Start time</Label>
            <Input
              id={`${idPrefix}-start`}
              type="time"
              value={state.startTime}
              onChange={(e) => set("startTime", e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-end`}>End time</Label>
            <Input
              id={`${idPrefix}-end`}
              type="time"
              value={state.endTime}
              onChange={(e) => set("endTime", e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>Who?</Label>
        <div className="flex flex-wrap gap-2">
          {activeMembers.map((member) => {
            const on = state.members.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set(
                    "members",
                    on
                      ? state.members.filter((m) => m !== member.id)
                      : [...state.members, member.id],
                  )
                }
                className={cn(
                  "flex h-11 max-w-full min-w-0 items-center gap-2 rounded-full pr-4 pl-1.5 text-sm font-semibold transition-all",
                  on
                    ? cn(styleFor(member.id).soft, "ring-2", styleFor(member.id).ring)
                    : "bg-surface-muted text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                    styleFor(member.id).badge,
                    !on && "opacity-60",
                  )}
                >
                  {member.initial}
                </span>
                <span className="min-w-0 truncate">{member.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {repeats && state.members.length > 0 ? (
        <div className="space-y-3 rounded-xl bg-surface-muted p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${idPrefix}-custom-days`} className="font-semibold">
              Customize days by person
            </Label>
            <Switch
              id={`${idPrefix}-custom-days`}
              checked={perPersonDays}
              disabled={state.recurrence === "custom"}
              onCheckedChange={(v) => set("customizeDays", v)}
            />
          </div>
          {perPersonDays ? (

            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Pick each person's days. The event only appears on days someone is scheduled.
              </p>
              {state.members.map((memberId) => {
                const member = activeMembers.find((m) => m.id === memberId);
                if (!member) return null;
                const selectedDays = state.memberWeekdays[memberId] ?? [];
                return (
                  <div key={memberId} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold",
                          styleFor(memberId).badge,
                        )}
                      >
                        {member.initial}
                      </span>
                      {member.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_CODES.map((day) => {
                        const on = selectedDays.includes(day.code);
                        return (
                          <button
                            key={day.code}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${member.name} ${day.label}`}
                            onClick={() =>
                              onChange({
                                ...state,
                                memberWeekdays: {
                                  ...state.memberWeekdays,
                                  [memberId]: on
                                    ? selectedDays.filter((d) => d !== day.code)
                                    : [...selectedDays, day.code],
                                },
                              })
                            }
                            className={cn(
                              "h-9 min-w-11 rounded-lg px-2 text-xs font-semibold transition-colors",
                              on
                                ? cn(styleFor(memberId).soft, "ring-2", styleFor(memberId).ring)
                                : "bg-background text-muted-foreground",
                            )}
                          >
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}


      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label>Event type</Label>
          <Select
            value={state.eventType}
            onValueChange={(v) => set("eventType", v as EventType)}
          >
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Repeats</Label>
          <Select value={state.recurrence} onValueChange={(v) => set("recurrence", v)}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCE_OPTIONS.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {repeats ? (
        <div className="space-y-3 rounded-2xl bg-surface-muted p-3">
          <p className="text-sm font-bold">Repeat settings</p>
          <p className="text-xs text-muted-foreground">
            Starts {startsLabel} · {state.recurrence === "custom" ? "custom schedule" : frequencyLabel}
          </p>

          <div className="space-y-2">
            <Label>Ends</Label>
            <div className="flex flex-wrap gap-2">
              {END_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={state.recurrenceEnd === option.id}
                  onClick={() => set("recurrenceEnd", option.id)}
                  className={cn(
                    "h-11 min-w-0 shrink rounded-full px-4 text-sm font-semibold transition-all",
                    state.recurrenceEnd === option.id
                      ? "bg-secondary font-bold ring-2 ring-primary"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {state.recurrenceEnd === "on" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-until`}>Repeat until</Label>
              <Input
                id={`${idPrefix}-until`}
                type="date"
                min={state.date}
                value={state.recurrenceUntil}
                onChange={(e) => set("recurrenceUntil", e.target.value)}
                className="h-11 rounded-xl bg-card"
              />
              <p className="text-xs text-muted-foreground">
                Includes the last repeat on or before this date.
              </p>
            </div>
          ) : null}

          {state.recurrenceEnd === "count" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-count`}>Number of occurrences</Label>
              <Input
                id={`${idPrefix}-count`}
                type="number"
                min={1}
                step={1}
                value={state.recurrenceCount}
                onChange={(e) => set("recurrenceCount", Math.max(1, Number(e.target.value) || 1))}
                className="h-11 rounded-xl bg-card"
              />
            </div>
          ) : null}

          {state.recurrenceEnd === "never" ? (
            <p className="text-xs text-muted-foreground">
              This event will keep repeating until you change or delete it.
            </p>
          ) : null}
        </div>
      ) : null}

      {syncedCalendars.length > 1 ? (
        <div className="space-y-1.5">
          <Label>Google calendar</Label>
          <Select
            value={shownCalendarSourceId ?? ""}
            onValueChange={(v) => set("calendarSourceId", v)}
          >
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {syncedCalendars.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.is_main ? " · Main" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select
          value={state.categoryId ?? UNCATEGORIZED_VALUE}
          onValueChange={(v) => set("categoryId", v === UNCATEGORIZED_VALUE ? null : v)}
        >
          <SelectTrigger className="h-11 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNCATEGORIZED_VALUE}>
              <span className="flex items-center gap-2">
                <span
                  className={cn("h-3 w-3 rounded-full", UNCATEGORIZED_APPEARANCE.swatch)}
                  aria-hidden
                />
                {UNCATEGORIZED_LABEL}
              </span>
            </SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                <span className="flex items-center gap-2">
                  <span
                    className={cn("h-3 w-3 rounded-full", categoryAppearance(category).swatch)}
                    aria-hidden
                  />
                  {category.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-location`}>Location</Label>
        <Input
          id={`${idPrefix}-location`}
          value={state.location}
          onChange={(e) => set("location", e.target.value)}
          placeholder="Riverside Fields"
          className="h-11 rounded-xl"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={state.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything else the family should know"
          className="min-h-20 rounded-xl"
        />
      </div>
    </div>
  );
}
