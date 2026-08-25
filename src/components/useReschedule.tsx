import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { format } from "date-fns";
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
import { runGuardedMutation } from "@/lib/async-submit";
import { useCalendar, type RecurrenceScope } from "@/lib/calendar-store";

import { isRecurring, rescheduleDraft } from "@/lib/reschedule";
import { formatTimeRange, type Occurrence } from "@/lib/family-data";

const SCOPES: { id: RecurrenceScope; label: string; hint: string }[] = [
  {
    id: "this",
    label: "Move this event only",
    hint: "The rest of the series keeps its original schedule.",
  },
  {
    id: "future",
    label: "Move this and future events",
    hint: "Earlier occurrences stay put; the repeat continues from the new time.",
  },
  {
    id: "series",
    label: "Move the entire series",
    hint: "Every occurrence shifts by the same amount, keeping the repeat rule.",
  },
];

interface Pending {
  occurrence: Occurrence;
  start: Date;
}

/**
 * Shared drag-and-drop rescheduling behavior for the calendar views.
 *
 * Editors can drag an event onto another day/time; recurring events first ask
 * which part of the series to move. Viewers get no drag handles at all.
 */
export function useReschedule() {
  const { canEdit, updateEvent } = useCalendar();
  const dragged = useRef<Occurrence | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [moving, setMoving] = useState(false);

  const apply = (occurrence: Occurrence, start: Date, scope: RecurrenceScope) =>
    runGuardedMutation({
      busy: moving,
      setBusy: setMoving,
      perform: () => updateEvent(occurrence, rescheduleDraft(occurrence, start, scope), scope),
      onSuccess: () =>
        toast.success(`${occurrence.event.title} moved to ${format(start, "EEE MMM d, h:mm a")}`),
      onError: toast.error,
      errorFallback: "Could not move that event. Please try again.",
    });



  const dragProps = (occurrence: Occurrence) =>
    canEdit
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            dragged.current = occurrence;
            setDraggingKey(occurrence.key);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", occurrence.key);
          },
          onDragEnd: () => {
            dragged.current = null;
            setDraggingKey(null);
          },
        }
      : {};

  /** `resolveStart` maps the drop position to the new start moment. */
  const dropProps = (
    resolveStart: (e: DragEvent<HTMLElement>, occurrence: Occurrence) => Date | null,
  ) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (!dragged.current) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            const occurrence = dragged.current;
            if (!occurrence) return;
            e.preventDefault();
            e.stopPropagation();
            dragged.current = null;
            setDraggingKey(null);
            const start = resolveStart(e, occurrence);
            if (!start || start.getTime() === occurrence.start.getTime()) return;
            if (isRecurring(occurrence)) setPending({ occurrence, start });
            else void apply(occurrence, start, "series");
          },
        }
      : {};

  const dialog: ReactNode = pending ? (
    <Dialog open onOpenChange={(next) => (next ? null : setPending(null))}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {pending.occurrence.event.title}?</DialogTitle>
          <DialogDescription>
            New time: {format(pending.start, "EEEE, MMM d")} ·{" "}
            {formatTimeRange(
              pending.start,
              new Date(
                pending.start.getTime() +
                  (pending.occurrence.end.getTime() - pending.occurrence.start.getTime()),
              ),
              pending.occurrence.event.all_day,
            )}
            . This event repeats — choose what to move.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                void apply(pending.occurrence, pending.start, option.id);
                setPending(null);
              }}
              className="rounded-2xl bg-surface-muted px-4 py-3 text-left transition-colors hover:bg-secondary"
            >
              <span className="block text-sm font-bold">{option.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            className="h-11 rounded-full"
            onClick={() => setPending(null)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { canDrag: canEdit, dragProps, dropProps, draggingKey, dialog };
}
