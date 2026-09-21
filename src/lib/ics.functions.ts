/**
 * Read-only Apple/iCloud calendar subscriptions.
 *
 * Isolated from Google sync on purpose: these functions only create/refresh/remove
 * one `calendar_sources` row (`provider = 'ics'`) and the events carrying that
 * source id. The subscription URL is a secret — it is encrypted server-side and
 * never returned to the browser.
 */

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveWritableFamily, type Db } from "@/lib/calendar-ops";
import {
  MEMBER_COLORS,
  type DisplayMode,
  type MemberColor,
} from "@/lib/family-data";

export interface IcsSubscriptionSummary {
  id: string;
  name: string;
  color: MemberColor | null;
  member_id: string | null;
  display_mode: DisplayMode;
  /** masked remnant of the saved link; never the full URL */
  hint: string;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
}

function assertName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("Give this calendar a name");
  if (name.length > 60) throw new Error("Calendar names must be 60 characters or fewer");
  return name;
}

function assertColor(value: unknown): MemberColor {
  if (typeof value === "string" && (MEMBER_COLORS as string[]).includes(value)) {
    return value as MemberColor;
  }
  throw new Error("Choose a color from the palette");
}

async function loadSubscriptions(db: Db, familyId: string): Promise<IcsSubscriptionSummary[]> {
  const { data, error } = await db
    .from("calendar_sources")
    .select(
      "id, name, color, subscription_member_id, display_mode, last_synced_at, sync_status, sync_error",
    )
    .eq("family_id", familyId)
    .eq("provider", "ics")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // Hints live with the secret row; the ciphertext itself never leaves the server.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: secrets } = await supabaseAdmin
    .from("ics_subscription_secrets")
    .select("source_id, url_hint")
    .in(
      "source_id",
      rows.map((r) => r.id as string),
    );
  const hintOf = new Map(
    ((secrets ?? []) as { source_id: string; url_hint: string }[]).map((s) => [s.source_id, s.url_hint]),
  );

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: (r.color ?? null) as MemberColor | null,
    member_id: (r.subscription_member_id ?? null) as string | null,
    display_mode: (r.display_mode ?? "events") as DisplayMode,
    hint: hintOf.get(r.id as string) ?? "calendar link",
    last_synced_at: (r.last_synced_at ?? null) as string | null,
    sync_status: (r.sync_status ?? "idle") as string,
    sync_error: (r.sync_error ?? null) as string | null,
  }));
}

export const listIcsSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as Db;
    const { data } = await db
      .from("family_users")
      .select("family_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1);
    const familyId = (data?.[0]?.family_id ?? null) as string | null;
    if (!familyId) return { subscriptions: [] as IcsSubscriptionSummary[] };
    return { subscriptions: await loadSubscriptions(db, familyId) };
  });

export const addIcsSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string; name: string; color: string; member_id?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const name = assertName(data.name);
    const color = assertColor(data.color);

    const { normalizeSubscriptionUrl, subscriptionHint, refreshSubscriptionRow } = await import(
      "@/lib/ics/import.server"
    );
    const { encryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const url = normalizeSubscriptionUrl(data.url);

    let memberId: string | null = null;
    if (data.member_id) {
      const { data: member } = await db
        .from("family_members")
        .select("id")
        .eq("id", data.member_id)
        .eq("family_id", familyId)
        .maybeSingle();
      memberId = (member?.id ?? null) as string | null;
    }

    const { data: siblings } = await db
      .from("calendar_sources")
      .select("sort_order")
      .eq("family_id", familyId);
    const sortOrder =
      ((siblings ?? []) as { sort_order: number | null }[]).reduce(
        (max, s) => Math.max(max, s.sort_order ?? 0),
        -1,
      ) + 1;

    const { data: created, error } = await db
      .from("calendar_sources")
      .insert({
        family_id: familyId,
        name,
        provider: "ics",
        display_mode: "events",
        active: true,
        is_main: false,
        selectable_in_email: true,
        sort_order: sortOrder,
        color,
        subscription_member_id: memberId,
        sync_status: "active",
      })
      .select("id")
      .single();
    if (error) throw error;

    const sourceId = created.id as string;
    const { error: secretError } = await supabaseAdmin.from("ics_subscription_secrets").upsert({
      source_id: sourceId,
      url_ciphertext: encryptConnectionKey(url),
      url_hint: subscriptionHint(url),
    });
    if (secretError) throw secretError;

    const { data: family } = await supabaseAdmin
      .from("families")
      .select("timezone")
      .eq("id", familyId)
      .maybeSingle();

    const result = await refreshSubscriptionRow(supabaseAdmin as never, {
      id: sourceId,
      family_id: familyId,
      name,
      subscription_member_id: memberId,
      timezone: (family?.timezone ?? null) as string | null,
    });

    if (!result.ok) {
      // A bad link should not leave a dead calendar behind.
      await supabaseAdmin.from("calendar_sources").delete().eq("id", sourceId).eq("family_id", familyId);
      throw new Error(result.error ?? "Could not read that calendar link");
    }

    return { id: sourceId, imported: result.created };
  });

export const refreshIcsSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data.id ?? "") }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const { data: source, error } = await db
      .from("calendar_sources")
      .select("id, family_id, name, subscription_member_id")
      .eq("id", data.id)
      .eq("family_id", familyId)
      .eq("provider", "ics")
      .maybeSingle();
    if (error) throw error;
    if (!source) throw new Error("That calendar subscription no longer exists");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshSubscriptionRow } = await import("@/lib/ics/import.server");
    const { data: family } = await supabaseAdmin
      .from("families")
      .select("timezone")
      .eq("id", familyId)
      .maybeSingle();

    const result = await refreshSubscriptionRow(supabaseAdmin as never, {
      id: source.id as string,
      family_id: familyId,
      name: source.name as string,
      subscription_member_id: (source.subscription_member_id ?? null) as string | null,
      timezone: (family?.timezone ?? null) as string | null,
    });
    if (!result.ok) throw new Error(result.error ?? "Could not refresh that calendar");
    return { created: result.created, updated: result.updated, deleted: result.deleted };
  });

export const updateIcsSubscriptionDisplayMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; display_mode: DisplayMode }) => ({
    id: String(data.id ?? ""),
    display_mode: data.display_mode,
  }))
  .handler(async ({ data, context }) => {
    if (data.display_mode !== "events" && data.display_mode !== "coverage_background") {
      throw new Error("Choose Event or Background");
    }

    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const { data: source, error } = await db
      .from("calendar_sources")
      .update({ display_mode: data.display_mode })
      .eq("id", data.id)
      .eq("family_id", familyId)
      .eq("provider", "ics")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!source) throw new Error("That calendar subscription no longer exists");

    return { ok: true };
  });

/**
 * Presentation metadata only. The subscribed Apple calendar is never modified —
 * this just changes how OFC paints its (still read-only) events.
 */
export const updateIcsSubscriptionAppearance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; color: string; icon: string | null }) => ({
    id: String(data.id ?? ""),
    color: data.color,
    icon: data.icon ?? null,
  }))
  .handler(async ({ data, context }) => {
    const { assertCalendarIcon } = await import("@/lib/calendar-appearance");
    const color = assertColor(data.color);
    const icon = assertCalendarIcon(data.icon);

    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const { data: source, error } = await db
      .from("calendar_sources")
      .update({ color, display_icon: icon })
      .eq("id", data.id)
      .eq("family_id", familyId)
      .eq("provider", "ics")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!source) throw new Error("That calendar subscription no longer exists");

    return { ok: true };
  });

export const removeIcsSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data.id ?? "") }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);

    const { data: source, error } = await db
      .from("calendar_sources")
      .select("id")
      .eq("id", data.id)
      .eq("family_id", familyId)
      .eq("provider", "ics")
      .maybeSingle();
    if (error) throw error;
    if (!source) throw new Error("That calendar subscription no longer exists");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only this subscription's imported events: manual events, Google-synced
    // events and other subscriptions never carry this calendar_source_id.
    const { error: eventsError } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("family_id", familyId)
      .eq("calendar_source_id", source.id as string);
    if (eventsError) throw eventsError;

    const { error: sourceError } = await supabaseAdmin
      .from("calendar_sources")
      .delete()
      .eq("id", source.id as string)
      .eq("family_id", familyId)
      .eq("provider", "ics");
    if (sourceError) throw sourceError;

    return { ok: true };
  });
