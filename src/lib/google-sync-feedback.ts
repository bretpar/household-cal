import { toast } from "sonner";

import { getEventSyncState } from "@/lib/calendar.functions";
import { syncNow } from "@/lib/google.functions";

/**
 * Saved vs. Google Synced feedback.
 *
 * The household database save is authoritative: as soon as it succeeds the
 * event is real and shown. Google is a downstream mirror, so its progress is
 * reported separately — "Saved · Syncing…" upgrades to "Synced" once the
 * outbound push has produced its sync link, and a failure offers a retry
 * instead of pretending the save went wrong.
 */
export type ForegroundSyncState = "synced" | "pending" | "unlinked" | "failed";

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 8;

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
  eventId: string | null,
  googleSync: ForegroundSyncState | undefined,
): void {
  // A real outbound failure is never dressed up as a success: the event is saved
  // here, but it is not in Google, and the user is told so.
  if (googleSync === "failed") {
    toast.error(`${savedMessage} · Google sync failed`, {
      description: "The event is saved here but didn’t reach Google Calendar.",
      action: retryAction(),
    });
    return;
  }
  if (googleSync !== "pending" || !eventId) {
    toast.success(savedMessage);
    return;
  }


  const toastId = toast.loading(`${savedMessage} · Syncing to Google…`);
  void (async () => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      let result: Awaited<ReturnType<typeof getEventSyncState>>;
      try {
        result = await getEventSyncState({ data: { event_id: eventId } });
      } catch {
        continue; // transient: keep showing "Syncing…" and try again
      }
      if (result.state === "synced" || result.state === "unlinked") {
        // "unlinked" means the event is not mapped to Google at all (no
        // connected calendar), so there is nothing left to wait for.
        toast.success(result.state === "synced" ? `${savedMessage} · Synced` : savedMessage, {
          id: toastId,
        });
        return;
      }
      if (result.state === "failed") {
        toast.error(`${savedMessage} · Google sync failed`, {
          id: toastId,
          description: result.error ?? undefined,
          action: {
            label: "Retry",
            onClick: () => {
              void syncNow({ data: {} }).catch(() => toast.error("Couldn’t start sync. Try again."));
            },
          },
        });
        return;
      }
    }
    toast.success(`${savedMessage} · Still syncing to Google`, { id: toastId });
  })();
}
