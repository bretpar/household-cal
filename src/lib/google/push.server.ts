/**
 * Fire-and-forget bridge from an app change to Google.
 *
 * Sync problems must never fail the user's save, so every failure is logged and
 * left for the reconciliation pass to repair.
 */
export async function pushToGoogle(familyId: string, eventId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pushEvent } = await import("@/lib/google/sync.server");
    const outcome = await pushEvent(supabaseAdmin, familyId, eventId);
    if (outcome.skipped) {
      // reconciliation / Sync now repairs these; the reason is recorded on the
      // event's sync links so an unsynced event is diagnosable, not invisible
      console.warn("[google-sync] push skipped", eventId, outcome.skipped);
    }
  } catch (error) {
    console.error("[google-sync] push failed", error);
  }
}

/** How long a save is willing to wait on Google before reporting "syncing". */
export const PUSH_DEADLINE_MS = 2500;

export type ForegroundSyncState = "synced" | "pending";

/**
 * Waits on outbound Google pushes only for as long as the user should wait.
 *
 * The pushes are never cancelled — they keep running and remain link-keyed, so
 * a slow Google call finishes in the background and the 15-minute reconcile
 * repairs anything a cut-off worker dropped. The return value tells the UI
 * whether it may already claim "Synced" or should show "Syncing…".
 */
export async function pushWithDeadline(
  familyId: string,
  eventIds: string[],
  deadlineMs = PUSH_DEADLINE_MS,
): Promise<ForegroundSyncState> {
  if (eventIds.length === 0) return "synced";
  const finished = Promise.all(eventIds.map((id) => pushToGoogle(familyId, id))).then(
    () => "synced" as const,
  );
  const timedOut = new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), deadlineMs));
  return Promise.race([finished, timedOut]);
}
