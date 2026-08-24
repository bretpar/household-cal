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
import { useCalendar } from "@/lib/calendar-store";
import {
  EVENT_TYPES,
  RECURRENCE_OPTIONS,
  type EventType,
  type MemberId,
  type Occurrence,
} from "@/lib/family-data";

export interface EventFormState {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  members: MemberId[];
  eventType: EventType;
  recurrence: string;
  location: string;
  notes: string;
}

export function emptyFormState(defaultDate?: Date): EventFormState {
  return {
    title: "",
    date: format(defaultDate ?? new Date(), "yyyy-MM-dd"),
    startTime: "16:00",
    endTime: "17:00",
    allDay: false,
    members: [],
    eventType: "activity",
    recurrence: "none",
    location: "",
    notes: "",
  };
}

export function formStateFromOccurrence(occurrence: Occurrence): EventFormState {
  const { event, start, end } = occurrence;
  const match = RECURRENCE_OPTIONS.find((r) => r.rule === event.recurrence_rule);
  return {
    title: event.title,
    date: format(start, "yyyy-MM-dd"),
    startTime: format(start, "HH:mm"),
    endTime: format(end, "HH:mm"),
    allDay: event.all_day,
    members: [...event.member_ids],
    eventType: event.event_type,
    recurrence: match?.id ?? (event.recurrence_rule ? "custom" : "none"),
    location: event.location ?? "",
    notes: event.notes ?? "",
  };
}

/** Copied details + the newly chosen day. Never a recurring series by default. */
export function formStateFromClipboard(clip: EventClipboard, date: Date): EventFormState {
  return {
    title: clip.title,
    date: format(date, "yyyy-MM-dd"),
    startTime: clip.startTime,
    endTime: clip.endTime,
    allDay: clip.allDay,
    members: [...clip.members],
    eventType: clip.eventType,
    recurrence: "none",
    location: clip.location,
    notes: clip.notes,
  };
}

function combine(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

export function draftFromFormState(
  state: EventFormState,
  calendarSourceId: string | null = null,
): EventDraft {
  const rule = RECURRENCE_OPTIONS.find((r) => r.id === state.recurrence)?.rule ?? null;
  return {
    title: state.title.trim(),
    start_at: state.allDay ? combine(state.date, "00:00") : combine(state.date, state.startTime),
    end_at: state.allDay ? combine(state.date, "23:59") : combine(state.date, state.endTime),
    all_day: state.allDay,
    location: state.location.trim() || null,
    notes: state.notes.trim() || null,
    event_type: state.eventType,
    recurrence_rule: rule,
    calendar_source_id: calendarSourceId,
    member_ids: state.members,
  };
}

export function validateFormState(state: EventFormState): string | null {
  if (!state.title.trim()) return "Please add an event name";
  if (state.members.length === 0) return "Choose at least one family member";
  return null;
}

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
  const { members, styleFor } = useCalendar();
  const activeMembers = members.filter((m) => m.active);

  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) =>
    onChange({ ...state, [key]: value });

  return (
    <div className="space-y-4">
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
          onChange={(e) => set("date", e.target.value)}
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
        <div className="grid grid-cols-2 gap-3">
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
                  "flex h-11 items-center gap-2 rounded-full pr-4 pl-1.5 text-sm font-semibold transition-all",
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
                {member.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
