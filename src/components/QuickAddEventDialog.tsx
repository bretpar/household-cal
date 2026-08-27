import { useEffect, useState } from "react";
import { format } from "date-fns";

import { Dialog } from "@/components/ui/dialog";
import { EventComposerContent } from "@/components/AddEventDialog";
import { emptyFormState, type EventFormState } from "@/components/EventForm";

/**
 * The Add Event form opened by press-and-hold on empty calendar space, with the
 * pressed date (and time, in Week/Day views) prefilled.
 */
export function QuickAddEventDialog({
  at,
  withTime,
  onClose,
}: {
  at: Date | null;
  withTime: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<EventFormState | null>(null);
  const key = at ? `${at.toISOString()}:${withTime}` : null;

  useEffect(() => {
    if (at) setState(emptyFormState(at, withTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!at || !state) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <EventComposerContent
        title="Add an event"
        description={
          withTime
            ? `${format(at, "EEEE, MMM d")} at ${format(at, "h:mm a")}`
            : format(at, "EEEE, MMM d")
        }
        state={state}
        onChange={setState}
        idPrefix="quick-add"
        onClose={onClose}
      />
    </Dialog>
  );
}
