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

import { applyRecurrenceExceptions, icsExternalId, parseIcs, withinWindow, type IcsEvent } from "@/lib/ics/parse";

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
  assertPublicFeedUrl(url);
  return url.toString();
}

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Only public HTTPS hosts on the default port; blocks internal/metadata targets. */
export function assertPublicFeedUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("Calendar links must start with https:// or webcal://");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("That calendar link is not supported");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host.includes(".") ||
    host.startsWith("[") ||
    host.includes(":") ||
    /^\d+$/.test(host) ||
    /^0x/i.test(host) ||
    isPrivateIpv4(host) ||
    host === "localhost" ||
    /\.(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host) ||
    host === "metadata.google.internal"
  ) {
    throw new Error("That calendar link is not supported");
  }
}

const REJECTED = "That calendar link is not supported";

function ipv4Octets(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/** True for any IPv4/IPv6 address that is not globally routable unicast. */
export function isNonPublicIp(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return isPrivateIpv4(ip) || (a === 192 && b === 0) || (a === 192 && b === 88) ||
      (a === 198 && b === 51) || (a === 203 && b === 0);
  }
  let h = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!h.includes(":")) return true; // not an IP we understand: fail closed
  // IPv4-mapped / embedded forms (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d)
  const tail = h.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) return true;
  if (h === "::" || h === "::1") return true;
  const first = parseInt(h.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h.startsWith("::")) return true; // ::/8 reserved incl. ::ffff:x:y hex mapped
  if (first === 0x2001 && /^2001:(0?db8|0{0,4}:|0{0,3}[0-1]?[0-9a-f]?:)/.test(h)) return true; // docs, Teredo, ORCHID ranges
  if (first === 0x2002) return true; // 6to4 can embed private IPv4
  if (first === 0x0064) return true; // 64:ff9b NAT64
  if (first === 0x0100) return true; // discard
  return (first & 0xe000) !== 0x2000; // only 2000::/3 is global unicast
}

/**
 * Resolves the host over DNS-over-HTTPS and rejects it when any A/AAAA answer is
 * non-public or nothing resolves. Runs on every hop immediately before fetch.
 */
async function assertResolvesPublic(host: string, signal: AbortSignal): Promise<void> {
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"]) {
    let res: Response;
    try {
      res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { Accept: "application/dns-json" }, signal },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error("We couldn't reach that calendar link");
    }
    if (!res.ok) throw new Error("We couldn't reach that calendar link");
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    for (const ans of body.Answer ?? []) {
      if (ans.type === 1 || ans.type === 28) addresses.push(ans.data.trim());
    }
  }
  if (!addresses.length || addresses.some(isNonPublicIp)) throw new Error(REJECTED);
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
    let current = new URL(url);
    assertPublicFeedUrl(current);
    let response: Response;
    for (let hop = 0; ; hop++) {
      await assertResolvesPublic(current.hostname.toLowerCase().replace(/\.$/, ""), controller.signal);
      response = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/calendar, text/plain, */*" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || hop >= 4) throw new Error("The calendar link redirected too many times");
      current = new URL(location.replace(/^webcal:\/\//i, "https://"), current);
      assertPublicFeedUrl(current);
    }
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
  for (const event of applyRecurrenceExceptions(feedEvents)) {
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
      .update({ sync_status: "needs_attention", sync_error: "The saved calendar link is missing" })
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
      .update({ sync_status: "active", sync_error: null, last_synced_at: new Date().toISOString() })
      .eq("id", subscription.id);
    return { ok: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh that calendar";
    console.error(`[ics] refresh failed for source ${subscription.id}: ${message}`);
    await admin
      .from("calendar_sources")
      .update({ sync_status: "needs_attention", sync_error: message })
      .eq("id", subscription.id);
    return { ok: false, error: message, fetched: 0, created: 0, updated: 0, deleted: 0 };
  }
}

/** Refreshes every ICS subscription in the project (scheduled job). */
export async function refreshAllSubscriptions(admin: Db): Promise<{ subscriptions: number }> {
  const { data, error } = await admin
    .from("calendar_sources")
    .select("id, family_id, name, subscription_member_id, families!calendar_sources_family_id_fkey(timezone)")
    .eq("provider", "ics");
  // PostgrestError is a plain object, not an Error: rethrow as one so the
  // scheduler logs the real message instead of "unknown error".
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as (IcsSubscriptionRow & { families?: { timezone?: string | null } | null })[];
  for (const row of rows) {
    await refreshSubscriptionRow(admin, { ...row, timezone: row.families?.timezone ?? null });
  }
  return { subscriptions: rows.length };
}
