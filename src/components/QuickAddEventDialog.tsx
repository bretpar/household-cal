import { useRef, useState } from "react";
import { format } from "date-fns";

import { Dialog } from "@/components/ui/dialog";
import { EventComposerContent } from "@/components/AddEventDialog";
import { emptyFormState, type EventFormState } from "@/components/EventForm";

/**
 * The Add Event form opened by press-and-hold on empty calendar space, with the
 * pressed date (and time, in Week/Day views) prefilled.
 *
 * State is reinitialized on every open transition (render-phase adjustment), so
 * pressing the same day/slot twice always starts from a blank form — even when
 * the slot's date/time key is identical to the previous one.
 */
export function QuickAddEventDialog({
  at,
  until,
  withTime,
  onClose,
}: {
  at: Date | null;
  /** end of the dragged preview block, when the gesture proposed one */
  until?: Date | null;
  withTime: boolean;
  onClose: () => void;
}) {
  const wasOpen = useRef(false);
  const [session, setSession] = useState<{ formKey: string; state: EventFormState } | null>(null);

  const isOpen = at !== null;
  if (isOpen !== wasOpen.current) {
    wasOpen.current = isOpen;
    if (isOpen && at) {
      const base = emptyFormState(at, withTime);
      const formKey = `${at.toISOString()}:${until?.toISOString() ?? ""}:${withTime}:${Date.now()}`;
      setSession({
        formKey,
        state: until ? { ...base, endTime: format(until, "HH:mm") } : base,
      });
    } else {
      setSession(null);
    }
  }

  if (!at || !session) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <EventComposerContent
        key={session.formKey}
        title="Add an event"
        description={
          withTime
            ? `${format(at, "EEEE, MMM d")} at ${format(at, "h:mm a")}`
            : format(at, "EEEE, MMM d")
        }
        state={session.state}
        onChange={(state) => setSession({ formKey: session.formKey, state })}
        idPrefix="quick-add"
        onClose={onClose}
      />
    </Dialog>
  );
}
