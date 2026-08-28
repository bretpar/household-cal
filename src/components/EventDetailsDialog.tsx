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
import { MemberBadge, MemberBadgeRow } from "@/components/MemberBadge";
import { eventTypeIcons } from "@/components/EventCard";
import {
  EventFormFields,
  draftFromFormState,
  formStateFromOccurrence,
  validateFormState,
  type EventFormState,
} from "@/components/EventForm";
import { UNCATEGORIZED_LABEL } from "@/lib/event-categories";
import { runGuardedMutation } from "@/lib/async-submit";
import { useCalendar, type RecurrenceScope } from "@/lib/calendar-store";

import {
  activityLabel,
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

/**
 * Prefills a dragged occurrence's proposed time. The duration is preserved and
 * nothing is saved until the user submits, so recurrence scope still applies.
 */
function withProposedStart(
  state: EventFormState,
  occurrence: Occurrence,
  start: Date,
): EventFormState {
  const duration = occurrence.end.getTime() - occurrence.start.getTime();
  const end = new Date(start.getTime() + duration);
  return {
    ...state,
    date: format(start, "yyyy-MM-dd"),
    startTime: format(start, "HH:mm"),
    endTime: format(end, "HH:mm"),
  };
}

function recurrenceLabel(occurrence: Occurrence) {
  return describeRecurrence(occurrence.event);
}

/** Single shared event-details surface, opened from every calendar view. */
export function EventDetailsDialog() {
  const {
    activeOccurrence,
    proposedStart,
    closeOccurrence,
    canEdit,
    updateEvent,
    deleteEvent,
    copyOccurrence,
    members,
    categoryAppearanceFor,
  } = useCalendar();

  const [mode, setMode] = useState<Mode>("details");
  const [scope, setScope] = useState<RecurrenceScope>("this");
  const [state, setState] = useState<EventFormState | null>(null);
  const [busy, setBusy] = useState(false);


  useEffect(() => {
    if (activeOccurrence) {
      // A touch drag lands straight in the edit form with the proposed time filled in.
      setMode(proposedStart ? "edit" : "details");
      setScope("this");
      const base = formStateFromOccurrence(activeOccurrence);
      setState(proposedStart ? withProposedStart(base, activeOccurrence, proposedStart) : base);
    }
  }, [activeOccurrence, proposedStart]);

  if (!activeOccurrence) return null;

  const occurrence = activeOccurrence;
  const { event, start, end } = occurrence;
  const Icon = eventTypeIcons[event.event_type];
  const repeats = recurrenceLabel(occurrence);
  const typeLabel = activityLabel(event.event_type);
  const appearance = categoryAppearanceFor(event);

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
      <DialogContent
        className="rounded-3xl sm:max-w-lg"
        hideClose={mode === "details"}
        {...(mode === "details" ? { onSwipeClose: closeOccurrence } : {})}
      >
        {mode === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-20">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{event.title}</span>
              </DialogTitle>
              <DialogDescription className="flex items-center gap-1.5">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${appearance.swatch}`}
                  aria-hidden
                />
                {/* One unified classification: never "Uncategorized · Activity". */}
                {appearance.label === UNCATEGORIZED_LABEL ||
                appearance.label.toLowerCase() === typeLabel.toLowerCase()
                  ? typeLabel
                  : `${appearance.label} · ${typeLabel}`}
              </DialogDescription>
              {canEdit ? (
                // Copy sits immediately left of Edit in the upper-right.
                <div className="absolute top-3.5 right-4 flex items-center gap-1 sm:top-5 sm:right-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="Copy event"
                    title="Copy event"
                    className="h-9 w-9 rounded-full"
                    onClick={() => {
                      copyOccurrence(occurrence);
                      toast.success(`Copied ${event.title} — pick a day to paste it`);
                      closeOccurrence();
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="Edit event"
                    title="Edit event"
                    className="h-9 w-9 rounded-full"
                    onClick={() => setMode("edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
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
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
                        <MemberBadge id={row.id} size="xs" />
                        <span className="truncate">{row.name}</span>
                      </span>
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

          </>
        ) : mode === "edit" ? (
          <>
            <DialogHeader>
              <DialogTitle>Edit event</DialogTitle>
              <DialogDescription>Update the details for {event.title}.</DialogDescription>
            </DialogHeader>

            {state ? (
              <div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-24 max-sm:pb-[max(7rem,env(safe-area-inset-bottom)+4rem)] sm:-mx-6 sm:px-6">
                <EventFormFields state={state} onChange={setState} idPrefix="edit" />
                {scopePicker}
                <div className="border-t pt-4">
                  <Button
                    variant="ghost"
                    type="button"
                    className="h-11 w-full rounded-full text-destructive"
                    onClick={() => setMode("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete event
                  </Button>
                </div>
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
                onClick={() => setMode("edit")}
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
