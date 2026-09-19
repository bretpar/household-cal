/**
 * Bridge from an app change to Google.
 *
 * Sync problems must never fail the user's save, so no failure is rethrown into
 * the local write path — but the real outcome is preserved and returned, so the
 * save can never be reported as "Synced" when Google never got the event.
 */
export type PushOutcome =
  | { ok: true }
  /** Nothing to push (no Google calendar, read-only subscription, ...). */
  | { ok: false; unlinked: true; reason: string }
  /** A genuine outbound failure; a durable diagnostic has been recorded. */
  | { ok: false; unlinked?: false; reason: string };

export async function pushToGoogle(familyId: string, eventId: string): Promise<PushOutcome> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pushEvent, BENIGN_PUSH_SKIPS } = await import("@/lib/google/sync.server");
    const outcome = await pushEvent(supabaseAdmin, familyId, eventId);
    if (outcome.skipped) {
      // pushEvent already recorded the reason on the event's sync links, or on
      // the event's calendar source when no link row exists at all.
      console.warn("[google-sync] push skipped", eventId, outcome.skipped);
      return BENIGN_PUSH_SKIPS.has(outcome.skipped)
        ? { ok: false, unlinked: true, reason: outcome.skipped }
        : { ok: false, reason: outcome.skipped };
    }
    if (!(outcome.pushed && outcome.pushed > 0)) {
      return { ok: false, reason: "no_google_event_written" };
    }
    return { ok: true };
  } catch (error) {
    console.error("[google-sync] push failed", error);
    return { ok: false, reason: error instanceof Error ? error.message : "unknown_error" };
  }
}

/** How long a save is willing to wait on Google before reporting "syncing". */
export const PUSH_DEADLINE_MS = 2500;

/**
 * - "synced"   every push landed in Google
 * - "pending"  still running when the user's wait ran out
 * - "unlinked" nothing to mirror (no connected Google calendar for this event)
 * - "failed"   an outbound push really failed; diagnostic state is persisted
 */
export type ForegroundSyncState = "synced" | "pending" | "unlinked" | "failed";

/**
 * Waits on outbound Google pushes only for as long as the user should wait.
 *
 * The pushes are never cancelled — they keep running and remain link-keyed, so
 * a slow Google call finishes in the background and the 15-minute reconcile
 * repairs anything a cut-off worker dropped. The return value tells the UI
 * whether it may already claim "Synced", must keep showing "Syncing…", or has
 * to report a real Google failure.
 */
export async function pushWithDeadline(
  familyId: string,
  eventIds: string[],
  deadlineMs = PUSH_DEADLINE_MS,
): Promise<ForegroundSyncState> {
  if (eventIds.length === 0) return "unlinked";
  const finished = Promise.all(eventIds.map((id) => pushToGoogle(familyId, id))).then(
    (outcomes): ForegroundSyncState => {
      if (outcomes.some((o) => !o.ok && !(o as { unlinked?: boolean }).unlinked)) return "failed";
      if (outcomes.every((o) => !o.ok)) return "unlinked";
      return "synced";
    },
  );
  const timedOut = new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), deadlineMs));
  return Promise.race([finished, timedOut]);
}
