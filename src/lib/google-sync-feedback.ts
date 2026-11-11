import { toast } from "sonner";

import { syncNow } from "@/lib/google.functions";

/**
 * Saved vs. Google Synced feedback.
 *
 * The household database save is authoritative: as soon as it succeeds the
 * event is real and shown, so the confirmation is brief and dismisses itself.
 * Google is a downstream mirror, and the header sync chip already reports its
 * progress, so a pending push stays silent here instead of pinning a
 * "Syncing to Google…" toast to the screen. Only a genuine outbound failure is
 * surfaced in the toast, and even that expires on its own so failures can never
 * stack up.
 */
export type ForegroundSyncState = "synced" | "pending" | "unlinked" | "failed";

/** Confirmation of a local save: short enough to acknowledge, not to read twice. */
const CONFIRM_DURATION_MS = 2000;
/** A real Google failure deserves longer, but still auto-dismisses. */
const FAILURE_DURATION_MS = 8000;

function retryAction() {
  return {
    label: "Retry",
    onClick: () => {
      void syncNow({ data: {} }).catch(() => toast.error("Couldn’t start sync. Try again."));
    },
  };
}

export function reportEventSaved(
  savedMessage: string,
  googleSync: ForegroundSyncState | undefined,
): void {
  // A real outbound failure is never dressed up as a success: the event is saved
  // here, but it is not in Google, and the user is told so. The header sync chip
  // keeps the issue visible after this toast expires.
  if (googleSync === "failed") {
    toast.error(`${savedMessage} · Google sync failed`, {
      description: "The event is saved here but didn’t reach Google Calendar.",
      action: retryAction(),
      duration: FAILURE_DURATION_MS,
    });
    return;
  }

  // Synced, pending, or not mapped to Google at all all read the same way: the
  // save landed. Google's progress belongs to the sync chip, so nothing here
  // waits on it or re-reports it.
  toast.success(savedMessage, { duration: CONFIRM_DURATION_MS });
}
