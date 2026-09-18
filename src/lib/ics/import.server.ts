/**
 * Read-only import for Apple/iCloud calendar subscriptions.
 *
 * Deliberately isolated from the Google sync engine: nothing here writes to
 * Google, reads `event_sync_links`, or shares state with `google/sync.server.ts`,
 * so this bridge can later be replaced by a native iOS integration without
 * touching the main event system.
 *
 * Every write is scoped to one `calendar_sources` row (`provider = 'ics'`), which
 * is what makes disconnecting safe: only rows carrying that source id are removed.
 */

import { icsExternalId, parseIcs, withinWindow, type IcsEvent } from "@/lib/ics/parse";

type Db = { from: (table: string) => any };

export const ICS_PAST_DAYS = 30;
export const ICS_FUTURE_MONTHS = 12;
const MAX_FEED_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 20_000;

export interface IcsSubscriptionRow {
  id: string;
  family_id: string;
  name: string;
  subscription_member_id: string | null;
}

export interface IcsImportResult {
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
}

/** `webcal://` is Apple's scheme for the same HTTPS document. */
export function normalizeSubscriptionUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste the Apple calendar link");
  const normalized = trimmed.replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("That does not look like a calendar link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Calendar links must start with https:// or webcal://");
  }
  return url.toString();
}

/** Safe-to-display remnant of a secret URL: host plus a short tail. */
export function subscriptionHint(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    const short = tail.length > 6 ? `…${tail.slice(-6)}` : tail;
    return `${parsed.host}/${short}`;
  } catch {
    return "calendar link";
  }
}

async function fetchFeed(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/calendar, text/plain, */*" },
    });
    if (!response.ok) {
      // Never echo the URL itself — it is a credential.
      throw new Error(`The calendar link returned ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_FEED_BYTES) {
      throw new Error("That calendar is too large to import");
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error("That link did not return a calendar file");
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The calendar link took too long to respond");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function importWindow(now = new Date()): { from: string; to: string } {
  const from = new Date(now.getTime() - ICS_PAST_DAYS * 86400000);
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + ICS_FUTURE_MONTHS);
  return { from: from.toISOString(), to: to.toISOString() };
}

interface DesiredRow {
  external_event_id: string;
  external_recurring_event_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates: string[];
}

function desiredRow(event: IcsEvent): DesiredRow {
  return {
    external_event_id: icsExternalId(event),
    external_recurring_event_id: event.recurrenceId ? event.uid : null,
    title: event.title,
    start_at: event.startAt,
    end_at: event.endAt,
    all_day: event.allDay,
    location: event.location,
    notes: event.description,
    recurrence_rule: event.recurrenceRule,
    recurrence_until: event.recurrenceUntil,
    excluded_dates: event.excludedDates,
  };
}

/** Pure diff so the import behaviour can be tested without a database. */
export function planIcsImport(
  feedEvents: IcsEvent[],
  existing: { id: string; external_event_id: string | null }[],
  window: { from: string; to: string },
): {
  create: DesiredRow[];
  update: { id: string; row: DesiredRow }[];
  deleteIds: string[];
} {
  const desired = new Map<string, DesiredRow>();
  for (const event of feedEvents) {
    if (event.cancelled) continue;
    if (!withinWindow(event, window)) continue;
    desired.set(icsExternalId(event), desiredRow(event));
  }

  const byExternalId = new Map<string, string>();
  const deleteIds: string[] = [];
  for (const row of existing) {
    const key = row.external_event_id ?? "";
    if (!key || !desired.has(key) || byExternalId.has(key)) {
      // Gone from the feed, or a duplicate left behind by an earlier run.
      deleteIds.push(row.id);
      continue;
    }
    byExternalId.set(key, row.id);
  }

  const create: DesiredRow[] = [];
  const update: { id: string; row: DesiredRow }[] = [];
  for (const [key, row] of desired) {
    const id = byExternalId.get(key);
    if (id) update.push({ id, row });
    else create.push(row);
  }

  return { create, update, deleteIds };
}

/**
 * Fetches the feed and reconciles this subscription's imported events.
 * `admin` must be the service-role client (the subscription URL and its imported
 * rows are server-owned).
 */
export async function importSubscription(
  admin: Db,
  subscription: IcsSubscriptionRow,
  url: string,
  householdTimeZone: string,
): Promise<IcsImportResult> {
  const text = await fetchFeed(url);
  const feedEvents = parseIcs(text, householdTimeZone);
  const window = importWindow();

  const { data: existingRows, error: existingError } = await admin
    .from("events")
    .select("id, external_event_id")
    .eq("family_id", subscription.family_id)
    .eq("calendar_source_id", subscription.id);
  if (existingError) throw existingError;

  const plan = planIcsImport(feedEvents, (existingRows ?? []) as { id: string; external_event_id: string | null }[], window);

  const base = {
    family_id: subscription.family_id,
    calendar_source_id: subscription.id,
    event_type: "other" as const,
    category_id: null,
    needs_family_assignment: false,
    last_change_source: "ics",
  };

  if (plan.create.length > 0) {
    const { data: inserted, error } = await admin
      .from("events")
      .insert(plan.create.map((row) => ({ ...base, ...row })))
      .select("id");
    if (error) throw error;
    if (subscription.subscription_member_id) {
      const links = ((inserted ?? []) as { id: string }[]).map((e) => ({
        event_id: e.id,
        family_member_id: subscription.subscription_member_id,
        weekdays: null,
      }));
      if (links.length > 0) {
        const { error: linkError } = await admin.from("event_members").insert(links);
        if (linkError) throw linkError;
      }
    }
  }

  for (const item of plan.update) {
    const { error } = await admin
      .from("events")
      .update({ ...item.row, last_change_source: "ics" })
      .eq("id", item.id)
      .eq("family_id", subscription.family_id)
      .eq("calendar_source_id", subscription.id);
    if (error) throw error;
  }

  if (plan.deleteIds.length > 0) {
    const { error } = await admin
      .from("events")
      .delete()
      .in("id", plan.deleteIds)
      .eq("family_id", subscription.family_id)
      .eq("calendar_source_id", subscription.id);
    if (error) throw error;
  }

  return {
    fetched: feedEvents.length,
    created: plan.create.length,
    updated: plan.update.length,
    deleted: plan.deleteIds.length,
  };
}

/** Runs one subscription's refresh and records its outcome on the source row. */
export async function refreshSubscriptionRow(
  admin: Db,
  subscription: IcsSubscriptionRow & { timezone?: string | null },
): Promise<IcsImportResult & { ok: boolean; error?: string }> {
  const { decryptConnectionKey } = await import("@/lib/google/crypto.server");

  const { data: secret, error: secretError } = await admin
    .from("ics_subscription_secrets")
    .select("url_ciphertext")
    .eq("source_id", subscription.id)
    .maybeSingle();
  if (secretError) throw secretError;
  if (!secret?.url_ciphertext) {
    await admin
      .from("calendar_sources")
      .update({ sync_status: "error", sync_error: "The saved calendar link is missing" })
      .eq("id", subscription.id);
    return { ok: false, error: "missing link", fetched: 0, created: 0, updated: 0, deleted: 0 };
  }

  try {
    const url = decryptConnectionKey(secret.url_ciphertext as string);
    const result = await importSubscription(
      admin,
      subscription,
      url,
      subscription.timezone || "UTC",
    );
    await admin
      .from("calendar_sources")
      .update({ sync_status: "idle", sync_error: null, last_synced_at: new Date().toISOString() })
      .eq("id", subscription.id);
    return { ok: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh that calendar";
    console.error(`[ics] refresh failed for source ${subscription.id}: ${message}`);
    await admin
      .from("calendar_sources")
      .update({ sync_status: "error", sync_error: message })
      .eq("id", subscription.id);
    return { ok: false, error: message, fetched: 0, created: 0, updated: 0, deleted: 0 };
  }
}

/** Refreshes every ICS subscription in the project (scheduled job). */
export async function refreshAllSubscriptions(admin: Db): Promise<{ subscriptions: number }> {
  const { data, error } = await admin
    .from("calendar_sources")
    .select("id, family_id, name, subscription_member_id, families(timezone)")
    .eq("provider", "ics");
  if (error) throw error;

  const rows = (data ?? []) as (IcsSubscriptionRow & { families?: { timezone?: string | null } | null })[];
  for (const row of rows) {
    await refreshSubscriptionRow(admin, { ...row, timezone: row.families?.timezone ?? null });
  }
  return { subscriptions: rows.length };
}
