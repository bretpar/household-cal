import { ClipboardCheck, X } from "lucide-react";

import { useCalendar } from "@/lib/calendar-store";

/** Subtle "Copied: …" indicator that follows the user between Today and Calendar. */
export function CopiedEventBar() {
  const { copiedEvent, clearCopiedEvent, canEdit } = useCalendar();
  if (!canEdit || !copiedEvent) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 px-4 pb-2 md:bottom-4">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-full border border-border-soft bg-surface/95 px-3 py-2 shadow-soft backdrop-blur">
        <ClipboardCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          Copied: <span className="font-bold">{copiedEvent.title}</span>
        </p>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Pick a day to paste
        </span>
        <button
          type="button"
          onClick={clearCopiedEvent}
          aria-label="Clear copied event"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
