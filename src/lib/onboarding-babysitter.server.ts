import type { Db } from "@/lib/onboarding.server";

/** Reuse the existing source insert, claiming the household identity once. */
export async function ensureOnboardingBabysitter(
  db: Db, familyId: string, create: () => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const read = async () => {
    const { data, error } = await db.from("families").select("babysitter_calendar_source_id").eq("id", familyId).single();
    if (error) throw error;
    return data?.babysitter_calendar_source_id as string | null;
  };
  const existing = await read();
  if (existing) return { id: existing };
  const created = await create();
  const { data, error } = await db.from("families")
    .update({ babysitter_calendar_source_id: created.id }).eq("id", familyId)
    .is("babysitter_calendar_source_id", null).select("id");
  if (!error && data?.length) return created;
  const { error: cleanupError } = await db.from("calendar_sources").delete().eq("id", created.id).eq("family_id", familyId);
  if (cleanupError) throw cleanupError;
  if (error) throw error;
  const winner = await read();
  if (!winner) throw new Error("Could not set up the Babysitter calendar. Try again.");
  return { id: winner };
}