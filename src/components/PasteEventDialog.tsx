import { useEffect, useState } from "react";
import { format } from "date-fns";

import { Dialog } from "@/components/ui/dialog";
import { EventComposerContent } from "@/components/AddEventDialog";
import { formStateFromClipboard, type EventFormState } from "@/components/EventForm";
import { useCalendar } from "@/lib/calendar-store";

/**
 * Opens when the user pastes a copied event onto a day: the add-event form
 * prefilled with the copied details and the newly chosen date.
 */
export function PasteEventDialog() {
  const { copiedEvent, pasteDate, cancelPaste, canEdit } = useCalendar();
  const [state, setState] = useState<EventFormState | null>(null);

  useEffect(() => {
    if (copiedEvent && pasteDate) setState(formStateFromClipboard(copiedEvent, pasteDate));
  }, [copiedEvent, pasteDate]);

  if (!canEdit || !copiedEvent || !pasteDate || !state) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? null : cancelPaste())}>
      <EventComposerContent
        title="Paste event"
        description={`Review the copied details for ${format(pasteDate, "EEEE, MMM d")} before saving.`}
        state={state}
        onChange={setState}
        idPrefix="paste"
        onClose={cancelPaste}
        calendarSourceId={copiedEvent.calendar_source_id}
      />
    </Dialog>
  );
}
