import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AnyDb = { from: (t: string) => any };

interface Input {
  member_id: string;
  /** undefined = not supplied; null = clear the household default */
  new_default?: string | null;
}

function parse(d: unknown): Input {
  const r = (d ?? {}) as Record<string, unknown>;
  const out: Input = { member_id: String(r["member_id"] ?? "") };
  if ("new_default" in r) out.new_default = typeof r["new_default"] === "string" && r["new_default"] ? (r["new_default"] as string) : null;
  return out;
}

/** Verifies owner + caregiver, returns household, linked memberships and admin client. */
async function prepare(ctx: { supabase: unknown; userId: string }, input: Input) {
  const db = ctx.supabase as unknown as AnyDb;
  const { data: member, error } = await db
    .from("family_members")
    .select("id, family_id, name, role, active, removed_at")
    .eq("id", input.member_id)
    .maybeSingle();
  if (error) throw error;
  if (!member || member.removed_at) throw new Error("Caregiver not found");
  if (member.role !== "caregiver") throw new Error("This person isn't a caregiver");
  const { requireOwner } = await import("@/lib/household.server");
  await requireOwner(db as never, ctx.userId, member.family_id);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as AnyDb;
  const fuRes = await admin
    .from("family_users")
    .select("id, role")
    .eq("family_id", member.family_id)
    .eq("family_member_id", member.id);
  if (fuRes.error) throw fuRes.error;
  const linked = (fuRes.data ?? []) as { id: string; role: string }[];
  return { member, admin, linked, linkedIds: linked.map((l) => l.id) };
}

/** Ensures no archived/removed caregiver stays the household default. */
async function resolveDefault(admin: AnyDb, familyId: string, memberId: string, linkedIds: string[], input: Input) {
  const { data, error } = await admin
    .from("families")
    .select("default_babysitter_member_id, default_babysitter_family_user_id")
    .eq("id", familyId)
    .single();
  if (error) throw error;
  const isDefault =
    data?.default_babysitter_member_id === memberId ||
    (!!data?.default_babysitter_family_user_id && linkedIds.includes(data.default_babysitter_family_user_id));
  if (!isDefault) return;
  if (input.new_default === undefined) {
    throw new Error("This caregiver is the default babysitter. Choose another default or clear it first.");
  }
  if (input.new_default === memberId) throw new Error("Choose a different default babysitter");
  if (input.new_default) {
    const { data: ok } = await admin
      .from("family_members")
      .select("id")
      .eq("id", input.new_default)
      .eq("family_id", familyId)
      .eq("role", "caregiver")
      .eq("active", true)
      .is("removed_at", null)
      .maybeSingle();
    if (!ok) throw new Error("Choose an active caregiver as the default");
  }
  const upd = await admin
    .from("families")
    .update({ default_babysitter_member_id: input.new_default, default_babysitter_family_user_id: null })
    .eq("id", familyId);
  if (upd.error) throw upd.error;
}

/** Revokes caregiver access in this household only: babysitter profile and viewer membership. */
async function revokeAccess(admin: AnyDb, linked: { id: string; role: string }[]) {
  for (const fu of linked) {
    if (fu.role !== "viewer") continue; // never touch owner/editor memberships
    const del = await admin.from("family_users").delete().eq("id", fu.id);
    if (del.error) throw del.error;
  }
}

/** Detaches caregiver shifts from the access profile but keeps the person linked (history/timesheets). */
async function preserveShifts(admin: AnyDb, member: { id: string; name: string }, linkedIds: string[]) {
  const patch = { assignment: "other", family_user_id: null, assignee_name: member.name, assignee_member_id: member.id };
  const byMember = await admin.from("babysitter_shifts").update(patch).eq("assignee_member_id", member.id).eq("assignment", "caregiver");
  if (byMember.error) throw byMember.error;
  if (linkedIds.length === 0) return;
  const keep = await admin.from("babysitter_shifts").update(patch).in("family_user_id", linkedIds).eq("assignment", "caregiver");
  if (keep.error) throw keep.error;
}

export const setCaregiverArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({ ...parse(d), archived: Boolean((d as any)?.archived) }))
  .handler(async ({ data, context }) => {
    const { member, admin, linked, linkedIds } = await prepare(context, data);
    if (data.archived) {
      await resolveDefault(admin, member.family_id, member.id, linkedIds, data);
      // Revoke active caregiver access; history stays linked to the person.
      await preserveShifts(admin, member, linkedIds);
      await revokeAccess(admin, linked);
    }
    const { error } = await admin
      .from("family_members")
      .update({ active: !data.archived })
      .eq("id", member.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteCaregiver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({
    ...parse(d),
    mode: (d as any)?.mode === "erase" ? ("erase" as const) : ("preserve" as const),
    confirm: String((d as any)?.confirm ?? ""),
  }))
  .handler(async ({ data, context }) => {
    const { member, admin, linked, linkedIds } = await prepare(context, data);
    if (data.mode === "erase" && data.confirm !== "DELETE") {
      throw new Error("Type DELETE to confirm");
    }
    await resolveDefault(admin, member.family_id, member.id, linkedIds, data);

    if (data.mode === "preserve") {
      await preserveShifts(admin, member, linkedIds);
      await revokeAccess(admin, linked);
      const { error } = await admin
        .from("family_members")
        .update({ active: false, removed_at: new Date().toISOString() })
        .eq("id", member.id);
      if (error) throw error;
      return { ok: true };
    }

    // erase: clear shift assignments, drop access, remove the person record.
    if (linkedIds.length > 0) {
      const clear = await admin
        .from("babysitter_shifts")
        .update({ assignment: "none", family_user_id: null, assignee_name: null })
        .in("family_user_id", linkedIds);
      if (clear.error) throw clear.error;
    }
    // Also clear history kept from an earlier archive.
    const clearKept = await admin
      .from("babysitter_shifts")
      .update({ assignment: "none", family_user_id: null, assignee_name: null, assignee_member_id: null })
      .eq("assignee_member_id", member.id);
    if (clearKept.error) throw clearKept.error;
    await revokeAccess(admin, linked);
    const unlink = await admin
      .from("family_users")
      .update({ family_member_id: null })
      .eq("family_member_id", member.id);
    if (unlink.error) throw unlink.error;
    // Cascades remove event/activity attendance links; events themselves stay.
    const { error } = await admin.from("family_members").delete().eq("id", member.id);
    if (error) throw error;
    return { ok: true };
  });

/** Owner-only: per-caregiver Timesheet eligibility. Independent of sign-in access; data is never deleted. */
export const setCaregiverTimesheets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({ ...parse(d), enabled: (d as any)?.enabled === true }))
  .handler(async ({ data, context }) => {
    const { member, admin } = await prepare(context, data);
    const { assertFeature } = await import("@/lib/features");
    assertFeature("timesheets", { familyId: member.family_id });
    const { error } = await admin.from("family_members").update({ timesheets_enabled: data.enabled }).eq("id", member.id);
    if (error) throw error;
    return { ok: true };
  });

/** Owner-only: keep the caregiver, revoke their household login (one transaction; shift history kept). */
export const removeCaregiverAppAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({ member_id: String((d as any)?.member_id ?? "") }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("remove_caregiver_app_access", { _member_id: data.member_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Owner-only: detach the login from the caregiver but keep it as an ordinary Viewer (one transaction). */
export const keepCaregiverLoginAsViewer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ({ member_id: String((d as any)?.member_id ?? "") }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("keep_caregiver_login_as_viewer", { _member_id: data.member_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
