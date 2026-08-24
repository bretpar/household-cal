/**
 * Household-scoped calendar read/write helpers.
 *
 * These run on the server with a Supabase client that is already scoped to the
 * authenticated user, so row-level security decides which household's rows are
 * visible or writable. Nothing here hard-codes a household, member or calendar.
 */

import type {
  CalendarEvent,
  CalendarSource,
  DisplayMode,
  EventParticipant,
  EventType,
  Family,
  FamilyActivity,
  FamilyMember,
  FamilyRole,
  MemberColor,
} from "@/lib/family-data";

/** Minimal shape of the Supabase client surface these helpers need. */
export type Db = { from: (table: string) => any };

export interface EventInput {
  calendar_source_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  event_type: EventType;
  recurrence_rule: string | null;
  /** yyyy-MM-dd last day the series may produce an occurrence, or null for open-ended. */
  recurrence_until?: string | null;
  member_ids: string[];
  /**
   * Optional per-person weekday rules inside one series, e.g. Bailey MO–TH and
   * Ellison TU–TH on the same School event. Members left out participate on
   * every occurrence.
   */
  member_weekdays?: Record<string, string[] | null> | undefined;
}


export type RecurrenceScope = "this" | "future" | "series";

export interface FamilyBundle {
  family: Family | null;
  members: FamilyMember[];
  sources: CalendarSource[];
  events: CalendarEvent[];
  activities: FamilyActivity[];
}

/** yyyy-MM-dd maths without timezone surprises. */
export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function asEventInput(data: unknown): EventInput {
  const raw = (data ?? {}) as Record<string, unknown>;
  if (typeof raw["title"] !== "string" || !raw["title"].trim()) {
    throw new Error("Please add an event name");
  }
  if (!Array.isArray(raw["member_ids"])) throw new Error("Choose at least one family member");
  return raw as unknown as EventInput;
}

export async function loadFamilyBundle(db: Db, userId: string): Promise<FamilyBundle> {
  const { data: memberships, error: mErr } = await db
    .from("family_users")
    .select("family_id, role, families(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (mErr) throw mErr;

  const membership = memberships?.[0];
  if (!membership) {
    return { family: null, members: [], sources: [], events: [], activities: [] };
  }

  const familyId = membership.family_id as string;
  const family: Family = {
    id: familyId,
    name: membership.families?.name ?? "Family",
    role: membership.role as FamilyRole,
  };

  const [membersRes, sourcesRes, eventsRes, activitiesRes] = await Promise.all([
    db
      .from("family_members")
      .select("*")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: true }),
    db
      .from("calendar_sources")
      .select("*")
      .eq("family_id", familyId)
      .order("sort_order", { ascending: true }),
    db
      .from("events")
      .select("*, event_members(family_member_id, weekdays)")
      .eq("family_id", familyId),

    db
      .from("activities")
      .select("*, activity_members(family_member_id)")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true }),
  ]);

  for (const res of [membersRes, sourcesRes, eventsRes, activitiesRes]) {
    if (res.error) throw res.error;
  }

  const sources: CalendarSource[] = (sourcesRes.data ?? []).map((s: any) => ({
    id: s.id,
    family_id: s.family_id,
    name: s.name,
    provider: s.provider,
    external_calendar_id: s.external_calendar_id,
    display_mode: s.display_mode as DisplayMode,
    active: s.active,
  }));
  const displayModeOf = new Map(sources.map((s) => [s.id, s.display_mode]));

  const members: FamilyMember[] = (membersRes.data ?? []).map((m: any) => ({
    id: m.id,
    family_id: m.family_id,
    name: m.name,
    initial: m.initial,
    color: m.color as MemberColor,
    role: m.role,
    access: m.access,
    active: m.active,
    sort_order: m.sort_order,
  }));

  const events: CalendarEvent[] = (eventsRes.data ?? []).map((e: any) => ({
    id: e.id,
    family_id: e.family_id,
    calendar_source_id: e.calendar_source_id,
    display_mode:
      (e.calendar_source_id ? displayModeOf.get(e.calendar_source_id) : "events") ?? "events",
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    all_day: e.all_day,
    location: e.location,
    notes: e.notes,
    event_type: e.event_type,
    recurrence_rule: e.recurrence_rule,
    recurrence_until: e.recurrence_until,
    excluded_dates: e.excluded_dates ?? [],
    external_event_id: e.external_event_id,
    external_recurring_event_id: e.external_recurring_event_id,
    participants: (e.event_members ?? []).map(
      (l: { family_member_id: string; weekdays: string[] | null }) => ({
        member_id: l.family_member_id,
        weekdays: (l.weekdays ?? null) as EventParticipant["weekdays"],
      }),
    ),
    member_ids: (e.event_members ?? []).map((l: { family_member_id: string }) => l.family_member_id),

  }));

  const activities: FamilyActivity[] = (activitiesRes.data ?? []).map((a: any) => ({
    id: a.id,
    family_id: a.family_id,
    name: a.name,
    event_type: a.event_type,
    location: a.location,
    schedule_label: a.schedule_label,
    recurrence_rule: a.recurrence_rule,
    active: a.active,
    member_ids: (a.activity_members ?? []).map(
      (l: { family_member_id: string }) => l.family_member_id,
    ),
  }));

  return { family, members, sources, events, activities };
}

/** The household the user may write to (owner or editor), defaulting to their first. */
export async function resolveWritableFamily(db: Db, userId: string): Promise<string> {
  const { data, error } = await db
    .from("family_users")
    .select("family_id, role")
    .eq("user_id", userId)
    .in("role", ["owner", "editor"])
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const familyId = data?.[0]?.family_id;
  if (!familyId) throw new Error("You do not have permission to change this calendar");
  return familyId;
}

export async function defaultEventSource(db: Db, familyId: string): Promise<string | null> {
  const { data } = await db
    .from("calendar_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("display_mode", "events")
    .order("sort_order", { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function insertEvent(
  db: Db,
  familyId: string,
  input: EventInput,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await db
    .from("events")
    .insert({
      family_id: familyId,
      calendar_source_id: input.calendar_source_id,
      title: input.title.trim(),
      start_at: input.start_at,
      end_at: input.end_at,
      all_day: input.all_day,
      location: input.location,
      notes: input.notes,
      event_type: input.event_type,
      recurrence_rule: input.recurrence_rule,
      recurrence_until: input.recurrence_rule ? (input.recurrence_until ?? null) : null,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  await linkMembers(db, data.id, input.member_ids, input.member_weekdays ?? {});
  return data.id as string;
}

export async function linkMembers(
  db: Db,
  eventId: string,
  memberIds: string[],
  memberWeekdays: Record<string, string[] | null> = {},
): Promise<void> {
  if (memberIds.length === 0) return;
  const { error } = await db.from("event_members").insert(
    memberIds.map((id) => {
      const days = memberWeekdays[id];
      return {
        event_id: eventId,
        family_member_id: id,
        // null = takes part in every occurrence of the series
        weekdays: days && days.length > 0 ? days : null,
      };
    }),
  );
  if (error) throw error;
}

export async function applyEventUpdate(
  db: Db,
  eventId: string,
  occurrenceDay: string,
  scope: RecurrenceScope,
  input: EventInput,
): Promise<void> {
  const { data: existing, error } = await db.from("events").select("*").eq("id", eventId).single();
  if (error) throw error;

  const familyId = existing.family_id as string;
  const sourceId = input.calendar_source_id ?? existing.calendar_source_id;

  if (!existing.recurrence_rule || scope === "series") {
    const { error: updateError } = await db
      .from("events")
      .update({
        title: input.title.trim(),
        start_at: input.start_at,
        end_at: input.end_at,
        all_day: input.all_day,
        location: input.location,
        notes: input.notes,
        event_type: input.event_type,
        recurrence_rule: input.recurrence_rule,
        recurrence_until: input.recurrence_rule ? (input.recurrence_until ?? null) : null,
        calendar_source_id: sourceId,
      })
      .eq("id", eventId);
    if (updateError) throw updateError;
    const { error: clearError } = await db.from("event_members").delete().eq("event_id", eventId);
    if (clearError) throw clearError;
    await linkMembers(db, eventId, input.member_ids, input.member_weekdays ?? {});
    return;
  }

  if (scope === "this") {
    // detach one occurrence: exclude it from the series, store a one-off event
    const excluded = [...(existing.excluded_dates ?? []), occurrenceDay];
    const { error: exError } = await db
      .from("events")
      .update({ excluded_dates: excluded })
      .eq("id", eventId);
    if (exError) throw exError;
    await insertEvent(db, familyId, {
      ...input,
      recurrence_rule: null,
      calendar_source_id: sourceId,
    });
    return;
  }

  // "future": end the old series the day before, start a new series here
  const { error: untilError } = await db
    .from("events")
    .update({ recurrence_until: shiftDayKey(occurrenceDay, -1) })
    .eq("id", eventId);
  if (untilError) throw untilError;
  await insertEvent(db, familyId, { ...input, calendar_source_id: sourceId });
}

export async function applyEventDelete(
  db: Db,
  eventId: string,
  occurrenceDay: string,
  scope: RecurrenceScope,
): Promise<void> {
  const { data: existing, error } = await db
    .from("events")
    .select("id, recurrence_rule, excluded_dates")
    .eq("id", eventId)
    .single();
  if (error) throw error;

  if (!existing.recurrence_rule || scope === "series") {
    const { error: delError } = await db.from("events").delete().eq("id", eventId);
    if (delError) throw delError;
    return;
  }

  if (scope === "this") {
    const excluded = [...(existing.excluded_dates ?? []), occurrenceDay];
    const { error: exError } = await db
      .from("events")
      .update({ excluded_dates: excluded })
      .eq("id", eventId);
    if (exError) throw exError;
    return;
  }

  const { error: untilError } = await db
    .from("events")
    .update({ recurrence_until: shiftDayKey(occurrenceDay, -1) })
    .eq("id", eventId);
  if (untilError) throw untilError;
}

/**
 * Resolves the household the signed-in user belongs to, without ever creating one.
 *
 * Order: existing membership → pending invitation for their email. Users with
 * neither get `null` and are sent through onboarding to create their own
 * household. Nothing here claims demo/sample households.
 */
export async function resolveMembership(
  admin: Db,
  userId: string,
  claimInvitations?: () => Promise<string | null>,
): Promise<string | null> {
  await admin.from("profiles").upsert({ id: userId }, { onConflict: "id" });

  const { data: existing } = await admin
    .from("family_users")
    .select("family_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) return existing[0].family_id as string;

  if (claimInvitations) {
    const invited = await claimInvitations();
    if (invited) return invited;
  }

  return null;
}

