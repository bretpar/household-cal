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
    await pushEvent(supabaseAdmin, familyId, eventId);
  } catch (error) {
    console.error("[google-sync] push failed", error);
  }
}
