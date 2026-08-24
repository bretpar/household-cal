import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EventFormFields,
  draftFromFormState,
  emptyFormState,
  validateFormState,
  type EventFormState,
} from "@/components/EventForm";
import { cn } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar-store";

export function AddEventDialog({
  defaultDate,
  className,
}: {
  defaultDate?: Date;
  className?: string;
}) {
  const { canEdit } = useCalendar();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => emptyFormState(defaultDate));

  if (!canEdit) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setState(emptyFormState(defaultDate));
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className={cn("h-11 rounded-full px-5 font-bold", className)}>
          <Plus className="h-4 w-4" />
          Add Event
        </Button>
      </DialogTrigger>
      <EventComposerContent
        title="Add an event"
        description="Everything the family needs to know, in one place."
        state={state}
        onChange={setState}
        idPrefix="add"
        onClose={() => setOpen(false)}
      />
    </Dialog>
  );
}

/** Shared dialog body used by both Add Event and Paste event. Nothing saves until confirmed. */
export function EventComposerContent({
  title,
  description,
  state,
  onChange,
  idPrefix,
  onClose,
  submitLabel = "Create event",
  calendarSourceId = null,
}: {
  title: string;
  description: string;
  state: EventFormState;
  onChange: (next: EventFormState) => void;
  idPrefix: string;
  onClose: () => void;
  submitLabel?: string;
  calendarSourceId?: string | null;
}) {
  const { addEvent } = useCalendar();

  const submit = () => {
    const error = validateFormState(state);
    if (error) {
      toast.error(error);
      return;
    }
    void addEvent(draftFromFormState(state, calendarSourceId));
    toast.success(`${state.title.trim()} added to the family calendar`);
    onClose();
  };

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <EventFormFields state={state} onChange={onChange} idPrefix={idPrefix} />

      <DialogFooter>
        <Button variant="ghost" type="button" className="h-11 rounded-full" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="h-11 rounded-full px-6 font-bold" onClick={submit}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
