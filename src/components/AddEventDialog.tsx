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
  defaultCalendarSourceId,
  emptyFormState,
  validateFormState,
  type EventFormState,
} from "@/components/EventForm";
import { cn } from "@/lib/utils";
import { runGuardedMutation } from "@/lib/async-submit";
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
  const { addEvent, sources } = useCalendar();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const error = validateFormState(state);
    if (error) {
      toast.error(error);
      return;
    }
    await runGuardedMutation({
      busy: saving,
      setBusy: setSaving,
      perform: () =>
        addEvent(
          draftFromFormState(state, calendarSourceId ?? defaultCalendarSourceId(sources)),
        ),
      onSuccess: () => {
        toast.success(`${state.title.trim()} added to the family calendar`);
        onClose();
      },
      onError: toast.error,
      errorFallback: "Could not save the event. Please try again.",
    });
  };


  return (
    <DialogContent className="rounded-3xl sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 max-sm:pb-[max(7rem,env(safe-area-inset-bottom)+4rem)] sm:-mx-6 sm:px-6">
        <EventFormFields state={state} onChange={onChange} idPrefix={idPrefix} />
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          type="button"
          className="h-11 rounded-full"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 rounded-full px-6 font-bold"
          onClick={() => void submit()}
          disabled={saving}
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

}
