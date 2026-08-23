import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, MapPin, NotebookPen, Pencil, Repeat, Trash2 } from "lucide-react";
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
import { useCalendar, type RecurrenceScope } from "@/lib/calendar-store";
import {
  EVENT_TYPES,
  RECURRENCE_OPTIONS,
  formatTimeRange,
  type Occurrence,
} from "@/lib/family-data";

const SCOPE_OPTIONS: { id: RecurrenceScope; label: string }[] = [
  { id: "this", label: "This event" },
  { id: "future", label: "This and future events" },
  { id: "series", label: "Entire series" },
];

type Mode = "details" | "edit" | "delete";

function recurrenceLabel(occurrence: Occurrence) {
  const rule = occurrence.event.recurrence_rule;
  if (!rule) return null;
  return RECURRENCE_OPTIONS.find((r) => r.rule === rule)?.label ?? "Repeats";
}

/** Single shared event-details surface, opened from every calendar view. */
export function EventDetailsDialog() {
  const { activeOccurrence, closeOccurrence, canEdit, updateEvent, deleteEvent } = useCalendar();
  const [mode, setMode] = useState<Mode>("details");
  const [scope, setScope] = useState<RecurrenceScope>("this");
  const [state, setState] = useState<EventFormState | null>(null);

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

  const saveEdit = () => {
    if (!state) return;
    const error = validateFormState(state);
    if (error) {
      toast.error(error);
      return;
    }
    void updateEvent(occurrence, draftFromFormState(state, event.calendar_source_id), scope);
    toast.success(`${state.title.trim()} updated`);
    closeOccurrence();
  };

  const confirmDelete = () => {
    void deleteEvent(occurrence, needsScope ? scope : "series");
    toast.success(`${event.title} deleted`);
    closeOccurrence();
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
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        {mode === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{event.title}</span>
              </DialogTitle>
              <DialogDescription>{typeLabel}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {format(start, "EEEE, MMM d")} · {formatTimeRange(start, end, event.all_day)}
              </p>
              {event.member_ids.length > 0 ? (
                <div className="flex items-center gap-2">
                  <MemberBadgeRow ids={event.member_ids} size="md" />
                </div>
              ) : null}
              {repeats ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Repeat className="h-4 w-4 shrink-0" aria-hidden />
                  {repeats}
                </p>
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
              <div className="space-y-5">
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
                onClick={saveEdit}
              >
                Save changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete {event.title}?</DialogTitle>
              <DialogDescription>
                {needsScope
                  ? "Choose how much of this repeating event to remove."
                  : "This event will be removed from the family calendar."}
              </DialogDescription>
            </DialogHeader>

            {scopePicker}

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                className="h-11 rounded-full"
                onClick={() => setMode("details")}
              >
                Keep event
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-11 rounded-full px-6 font-bold"
                onClick={confirmDelete}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
