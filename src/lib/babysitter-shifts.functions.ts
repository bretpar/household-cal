import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ShiftSettings {
  family_id: string;
  /** household Babysitter calendar; null = not chosen yet */
  calendar_source_id: string | null;
  /** default caregiver record (family_members.id) */
  default_member_id: string | null;
  /** all active registered caregivers, with or without sign-in access */
  caregivers: {
    family_member_id: string;
    name: string;
    /** limited-view login membership, when the caregiver has sign-in access */
    family_user_id: string | null;
    has_sign_in: boolean;
    timesheets_enabled: boolean;
    timesheet_start_date: string | null;
  }[];
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
    const [famRes, memRes, linkRes] = await Promise.all([
      admin
        .from("families")
        .select("babysitter_calendar_source_id, default_babysitter_member_id")
        .eq("id", fam.family_id)
        .single(),
      admin
        .from("family_members")
        .select("id, name, sort_order, timesheets_enabled, timesheet_start_date")
        .eq("family_id", fam.family_id)
        .eq("role", "caregiver")
        .eq("active", true)
        .is("removed_at", null)
        .order("sort_order", { ascending: true }),
      admin
        .from("babysitter_access_profiles")
        .select("family_user_id, family_users!inner(family_member_id)")
        .eq("family_id", fam.family_id),
    ]);
    if (famRes.error) throw famRes.error;
    if (memRes.error) throw memRes.error;
    if (linkRes.error) throw linkRes.error;
    const linked = new Map<string, string>(
      (linkRes.data ?? [])
        .filter((r: any) => r.family_users?.family_member_id)
        .map((r: any) => [r.family_users.family_member_id as string, r.family_user_id as string]),
    );
    const caregivers = (memRes.data ?? []).map((m: any) => ({
      family_member_id: m.id as string,
      name: m.name as string,
      family_user_id: linked.get(m.id) ?? null,
      has_sign_in: linked.has(m.id),
      timesheets_enabled: m.timesheets_enabled === true,
      timesheet_start_date: (m.timesheet_start_date as string | null) ?? null,
    }));
    return {
      family_id: fam.family_id,
      calendar_source_id: famRes.data?.babysitter_calendar_source_id ?? null,
      default_member_id: famRes.data?.default_babysitter_member_id ?? null,
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
      default_member_id: id(r["default_member_id"]),
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
        default_babysitter_member_id: data.default_member_id,
      })
      .eq("id", fam.family_id);
    if (error) throw error;
    return { ok: true };
  });
