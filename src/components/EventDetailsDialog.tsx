import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Copy, MapPin, NotebookPen, Pencil, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberBadgeRow } from "@/components/MemberBadge";
import { eventTypeIcons } from "@/components/EventCard";
import {
  EventFormFields,
  draftFromFormState,
  formStateFromOccurrence,
  validateFormState,
  type EventFormState,
} from "@/components/EventForm";
import { runGuardedMutation } from "@/lib/async-submit";
import { useCalendar, type RecurrenceScope } from "@/lib/calendar-store";

import {
  EVENT_TYPES,
  describeRecurrence,
  describeWeekdays,
  formatTimeRange,
  type Occurrence,
} from "@/lib/family-data";

const SCOPE_OPTIONS: { id: RecurrenceScope; label: string }[] = [
  { id: "this", label: "This event" },
  { id: "future", label: "This and future events" },
  { id: "series", label: "Entire series" },
];

/** Explicit delete choices for a recurring series. */
const DELETE_OPTIONS: { id: RecurrenceScope; label: string; hint: string }[] = [
  {
    id: "this",
    label: "Delete this event only",
    hint: "Removes only this occurrence. The rest of the series stays.",
  },
  {
    id: "future",
    label: "Delete this and future events",
    hint: "Removes this occurrence and every later one. Past occurrences stay.",
  },
  {
    id: "series",
    label: "Delete entire series",
    hint: "Removes every occurrence of this repeating event.",
  },
];

type Mode = "details" | "edit" | "delete";

function recurrenceLabel(occurrence: Occurrence) {
  return describeRecurrence(occurrence.event);
}

/** Single shared event-details surface, opened from every calendar view. */
export function EventDetailsDialog() {
  const {
    activeOccurrence,
    closeOccurrence,
    canEdit,
    updateEvent,
    deleteEvent,
    copyOccurrence,
    members,
  } = useCalendar();

  const [mode, setMode] = useState<Mode>("details");
  const [scope, setScope] = useState<RecurrenceScope>("this");
  const [state, setState] = useState<EventFormState | null>(null);
  const [busy, setBusy] = useState(false);


  useEffect(() => {
    if (activeOccurrence) {
      setMode("details");
      setScope("this");
      setState(formStateFromOccurrence(activeOccurrence));
    }
  }, [activeOccurrence]);

  if (!activeOccurrence) return null;

  const occurrence = activeOccurrence;
  const { event, start, end } = occurrence;
  const Icon = eventTypeIcons[event.event_type];
  const repeats = recurrenceLabel(occurrence);
  const typeLabel = EVENT_TYPES.find((t) => t.id === event.event_type)?.label ?? "Other";

  const needsScope = Boolean(event.recurrence_rule);

  // only shown when someone in the series has their own weekdays
  const perPersonDays = event.participants
    .filter((p) => p.weekdays && p.weekdays.length > 0)
    .map((p) => ({
      id: p.member_id,
      name: members.find((m) => m.id === p.member_id)?.name ?? "Member",
      days: describeWeekdays(p.weekdays),
    }));


  const saveEdit = async () => {
    if (!state) return;
    const error = validateFormState(state);
    if (error) {
      toast.error(error);
      return;
    }
    await runGuardedMutation({
      busy,
      setBusy,
      perform: () =>
        updateEvent(occurrence, draftFromFormState(state, event.calendar_source_id), scope),
      onSuccess: () => {
        toast.success(`${state.title.trim()} updated`);
        closeOccurrence();
      },
      onError: toast.error,
      errorFallback: "Could not save your changes. Please try again.",
    });
  };

  const confirmDelete = async (deleteScope: RecurrenceScope) => {
    await runGuardedMutation({
      busy,
      setBusy,
      perform: () => deleteEvent(occurrence, needsScope ? deleteScope : "series"),
      onSuccess: () => {
        toast.success(`${event.title} deleted`);
        closeOccurrence();
      },
      onError: toast.error,
      errorFallback: "Could not delete that event. Please try again.",
    });
  };



  const scopePicker = needsScope ? (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Apply to</p>
      <div className="flex flex-col gap-2">
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={scope === option.id}
            onClick={() => setScope(option.id)}
            className={
              scope === option.id
                ? "flex h-11 items-center rounded-xl bg-secondary px-3 text-sm font-bold ring-2 ring-primary"
                : "flex h-11 items-center rounded-xl bg-surface-muted px-3 text-sm font-semibold text-muted-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <Dialog open onOpenChange={(next) => (next ? null : closeOccurrence())}>
      <DialogContent className="rounded-3xl sm:max-w-lg">
        {mode === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{event.title}</span>
              </DialogTitle>
              <DialogDescription>{typeLabel}</DialogDescription>
            </DialogHeader>

            <div className="-mx-4 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 text-sm sm:-mx-6 sm:px-6">
              <p className="flex items-center gap-2 font-semibold">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {format(start, "EEEE, MMM d")} · {formatTimeRange(start, end, event.all_day)}
              </p>
              {occurrence.member_ids.length > 0 ? (
                <div className="flex items-center gap-2">
                  <MemberBadgeRow ids={occurrence.member_ids} size="md" />
                </div>
              ) : null}
              {event.needs_family_assignment ? (
                <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                  Came from Google · needs family assignment
                </p>
              ) : null}
              {perPersonDays.length > 0 ? (
                <div className="space-y-1 rounded-xl bg-surface-muted px-3 py-2 text-xs">
                  <span className="font-bold">Days by person</span>
                  {perPersonDays.map((row) => (
                    <div key={row.id} className="flex justify-between gap-3 text-muted-foreground">
                      <span className="font-semibold text-foreground">{row.name}</span>
                      <span>{row.days}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {needsScope ? (
                <div className="flex items-start gap-2 rounded-xl bg-surface-muted px-3 py-2 text-xs">
                  <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="block font-bold">Part of a repeating series</span>
                    {repeats ? (
                      <span className="mt-0.5 block text-muted-foreground">{repeats}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {event.location ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                  {event.location}
                </p>
              ) : null}
              {event.notes ? (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <NotebookPen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {event.notes}
                </p>
              ) : null}
            </div>

            {canEdit ? (
              <DialogFooter>
                <Button
                  variant="ghost"
                  type="button"
                  className="h-11 rounded-full text-destructive"
                  onClick={() => setMode("delete")}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  className="h-11 rounded-full font-semibold"
                  onClick={() => {
                    copyOccurrence(occurrence);
                    toast.success(`Copied ${event.title} — pick a day to paste it`);
                    closeOccurrence();
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-full px-6 font-bold"
                  onClick={() => setMode("edit")}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : mode === "edit" ? (
          <>
            <DialogHeader>
              <DialogTitle>Edit event</DialogTitle>
              <DialogDescription>Update the details for {event.title}.</DialogDescription>
            </DialogHeader>

            {state ? (
              <div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 sm:-mx-6 sm:px-6">
                <EventFormFields state={state} onChange={setState} idPrefix="edit" />
                {scopePicker}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                className="h-11 rounded-full"
                onClick={() => setMode("details")}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-11 rounded-full px-6 font-bold"
                onClick={() => void saveEdit()}
                disabled={busy}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>

            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete {event.title}?</DialogTitle>
              <DialogDescription>
                {needsScope
                  ? "This event repeats. Choose how much of the series to remove."
                  : "This event will be removed from the family calendar."}
              </DialogDescription>
            </DialogHeader>

            {needsScope ? (
              <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 sm:-mx-6 sm:px-6">
                {DELETE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmDelete(option.id)}
                    className="rounded-2xl bg-surface-muted px-4 py-3 text-left transition-colors hover:bg-secondary disabled:opacity-60"
                  >

                    <span className="block text-sm font-bold text-destructive">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                className="h-11 rounded-full"
                onClick={() => setMode("details")}
              >
                Cancel
              </Button>
              {needsScope ? null : (
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 rounded-full px-6 font-bold"
                  onClick={() => void confirmDelete("series")}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete"}
                </Button>

              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
