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
  const { addEvent, canEdit } = useCalendar();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => emptyFormState(defaultDate));

  if (!canEdit) return null;

  const submit = () => {
    const error = validateFormState(state);
    if (error) {
      toast.error(error);
      return;
    }
    addEvent(draftFromFormState(state));
    toast.success(`${state.title.trim()} added to the family calendar`);
    setState(emptyFormState(defaultDate));
    setOpen(false);
  };

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
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an event</DialogTitle>
          <DialogDescription>Everything the family needs to know.</DialogDescription>
        </DialogHeader>

        <EventFormFields state={state} onChange={setState} idPrefix="add" />

        <DialogFooter>
          <Button
            variant="ghost"
            className="h-11 rounded-full"
            onClick={() => setOpen(false)}
            type="button"
          >
            Cancel
          </Button>
          <Button className="h-11 rounded-full px-6 font-bold" onClick={submit} type="button">
            Save event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
