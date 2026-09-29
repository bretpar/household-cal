import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ShiftSettings {
  family_id: string;
  /** household Babysitter calendar; null = not chosen yet */
  calendar_source_id: string | null;
  default_family_user_id: string | null;
  /** registered caregivers (babysitter access profiles) */
  caregivers: { family_user_id: string; name: string }[];
}

type AnyDb = { from: (t: string) => any; rpc: (f: string, a: unknown) => any };

async function currentFamily(db: AnyDb, userId: string) {
  const { data, error } = await db
    .from("family_users")
    .select("family_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("No household found");
  return row as { family_id: string; role: string };
}

/** Editors/owners: Babysitter calendar, default and caregiver names for the event form. */
export const getShiftSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShiftSettings | null> => {
    const db = context.supabase as unknown as AnyDb;
    const fam = await currentFamily(db, context.userId);
    if (fam.role !== "owner" && fam.role !== "editor") return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as AnyDb;
    const [famRes, profRes] = await Promise.all([
      admin
        .from("families")
        .select("babysitter_calendar_source_id, default_babysitter_family_user_id")
        .eq("id", fam.family_id)
        .single(),
      admin
        .from("babysitter_access_profiles")
        .select("family_user_id, family_users!inner(family_member_id, family_members(name))")
        .eq("family_id", fam.family_id),
    ]);
    if (famRes.error) throw famRes.error;
    if (profRes.error) throw profRes.error;
    const caregivers = (profRes.data ?? []).map((p: any) => ({
      family_user_id: p.family_user_id as string,
      name: (p.family_users?.family_members?.name as string | undefined) ?? "Babysitter",
    }));
    return {
      family_id: fam.family_id,
      calendar_source_id: famRes.data?.babysitter_calendar_source_id ?? null,
      default_family_user_id: famRes.data?.default_babysitter_family_user_id ?? null,
      caregivers,
    };
  });

/** Owners: choose the Babysitter calendar and default babysitter. Not retroactive. */
export const updateShiftSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const r = (d ?? {}) as Record<string, unknown>;
    const id = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
    return {
      calendar_source_id: id(r["calendar_source_id"]),
      default_family_user_id: id(r["default_family_user_id"]),
    };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as AnyDb;
    const fam = await currentFamily(db, context.userId);
    if (fam.role !== "owner") throw new Error("Only owners can change babysitter settings");
    // RLS (owner-only update) plus a database trigger validate both ids.
    const { error } = await db
      .from("families")
      .update({
        babysitter_calendar_source_id: data.calendar_source_id,
        default_babysitter_family_user_id: data.default_family_user_id,
      })
      .eq("id", fam.family_id);
    if (error) throw error;
    return { ok: true };
  });
