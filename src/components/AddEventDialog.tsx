import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { reportEventSaved } from "@/lib/google-sync-feedback";

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
  /** icon-only trigger for compact mobile toolbars */
  compact = false,
}: {
  defaultDate?: Date;
  className?: string;
  compact?: boolean;
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
        {compact ? (
          <Button
            size="icon"
            aria-label="Add event"
            className={cn("h-9 w-9 shrink-0 rounded-full", className)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="lg" className={cn("h-11 rounded-full px-5 font-bold", className)}>
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        )}
      </DialogTrigger>

      <EventComposerContent
        title="Add an event"
        description="Keep everyone in the loop."
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
  const { addEvent, sources, family } = useCalendar();
  const [saving, setSaving] = useState(false);
  // Shown inside the dialog so a blocked submit is never silent, even if a
  // toast is off-screen or covered.
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    const destinationId = calendarSourceId ?? defaultCalendarSourceId(sources);
    const error = validateFormState(state, {
      babysitterCalendarSourceId: family?.babysitter_calendar_source_id ?? null,
      fallbackCalendarSourceId: destinationId,
    });
    setFormError(error);
    if (error) {
      toast.error(error);
      return;
    }
    await runGuardedMutation({
      busy: saving,
      setBusy: setSaving,
      perform: () =>
        addEvent(draftFromFormState(state, destinationId, family?.babysitter_calendar_source_id ?? null)),
      onSuccess: (result) => {
        // The household save is authoritative here; Google mirroring is
        // reported separately so a slow Google call never looks like a failure.
        reportEventSaved(
          `${state.title.trim()} added to the family calendar`,
          result?.google_sync,
        );
        onClose();
      },
      onError: toast.error,
      errorFallback: "Could not save the event. Please try again.",
    });
  };


  return (
    <DialogContent className="rounded-3xl sm:max-w-lg" mobileViewportSafe mobileEventSheetKey={idPrefix} onMobileBackdropClose={onClose}>
      {/* Phone: stationary header row with Cancel / title / Save. Desktop keeps
          the title block above the form and the action footer below it. */}
      <DialogHeader className="max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-1 max-sm:space-y-0 max-sm:border-b max-sm:border-border-soft max-sm:px-2 max-sm:py-2">
        <Button
          variant="ghost"
          type="button"
          className="hidden h-10 rounded-full px-3 max-sm:inline-flex"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <div className="min-w-0 max-sm:text-center">
          <DialogTitle className="max-sm:text-base">{title}</DialogTitle>
          <DialogDescription className="whitespace-nowrap truncate max-sm:hidden">{description}</DialogDescription>
        </div>
        <Button
          type="button"
          className="hidden h-10 rounded-full px-4 font-bold max-sm:inline-flex"
          onClick={() => void submit()}
          disabled={saving}
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
      </DialogHeader>

      <div data-event-form-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2 sm:-mx-6 sm:px-6">
        <EventFormFields
          state={state}
          onChange={(next) => {
            if (formError) setFormError(null);
            onChange(next);
          }}
          idPrefix={idPrefix}
        />
      </div>

      {formError ? (
        <p role="alert" className="shrink-0 px-5 text-sm font-semibold text-destructive sm:px-0">
          {formError}
        </p>
      ) : null}

      <DialogFooter className="border-t border-border-soft pt-3 max-sm:hidden">
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
