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
    /^[\d.]+$/.test(host) || // any IPv4 literal, public or not
    ipv4Octets(host) !== null ||
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

type Cidr4 = [number, number];
const ip4 = (a: number, b: number, c: number, d: number) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
/** RFC 6890 / IANA special-purpose IPv4 blocks that are not globally reachable. */
const NON_PUBLIC_V4: Cidr4[] = [
  [ip4(0, 0, 0, 0), 8], [ip4(10, 0, 0, 0), 8], [ip4(100, 64, 0, 0), 10], [ip4(127, 0, 0, 0), 8],
  [ip4(169, 254, 0, 0), 16], [ip4(172, 16, 0, 0), 12], [ip4(192, 0, 0, 0), 24], [ip4(192, 0, 2, 0), 24],
  [ip4(192, 31, 196, 0), 24], [ip4(192, 52, 193, 0), 24], [ip4(192, 88, 99, 0), 24], [ip4(192, 168, 0, 0), 16],
  [ip4(192, 175, 48, 0), 24], [ip4(198, 18, 0, 0), 15], [ip4(198, 51, 100, 0), 24], [ip4(203, 0, 113, 0), 24],
  [ip4(224, 0, 0, 0), 4], [ip4(240, 0, 0, 0), 4],
];
function inCidr4(v: number, [base, bits]: Cidr4): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((v & mask) >>> 0) === ((base & mask) >>> 0);
}
function isNonPublicV4(o: number[]): boolean {
  const v = ip4(o[0]!, o[1]!, o[2]!, o[3]!);
  return NON_PUBLIC_V4.some((c) => inCidr4(v, c));
}

/** Strict IPv6 parser → 8 hextets, or null when malformed. */
export function parseIpv6(raw: string): number[] | null {
  let h = raw.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(h) || h.length > 45) return null;
  const words: number[] = [];
  const v4 = h.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let tail: number[] = [];
  if (v4) {
    const o = ipv4Octets(v4[2]!);
    if (!o) return null;
    tail = [(o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!];
    h = v4[1]!.endsWith("::") ? v4[1]! : v4[1]!.slice(0, -1);
  }
  if (h.includes(".")) return null;
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const group = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = group(parts[0]!);
  const rest = parts.length === 2 ? group(parts[1]!) : [];
  if (!head || !rest) return null;
  const total = head.length + rest.length + tail.length;
  if (parts.length === 1) {
    if (total !== 8) return null;
    words.push(...head, ...tail);
  } else {
    if (total > 7) return null;
    words.push(...head, ...new Array(8 - total).fill(0), ...rest, ...tail);
  }
  return words.length === 8 ? words : null;
}

/** Prefix match on hextets: [prefix words, prefix length in bits]. */
function inCidr6(w: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; bits > 0; i++, bits -= 16) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((w[i] ?? 0) & mask) !== ((prefix[i] ?? 0) & mask)) return false;
  }
  return true;
}
/** Non-global blocks inside 2000::/3 (IANA IPv6 special-purpose registry). */
const NON_PUBLIC_V6_IN_GLOBAL: [number[], number][] = [
  [[0x2001, 0x0000], 23], // IETF protocol assignments (Teredo, ORCHID, benchmarking…)
  [[0x2001, 0x0db8], 32], // documentation
  [[0x2002], 16], // 6to4 (can embed private IPv4)
  [[0x3fff, 0x0000], 20], // documentation (RFC 9637)
];

/**
 * True for any IPv4/IPv6 address that is not globally routable unicast.
 * Fails closed: anything that does not parse as a valid address is non-public.
 */
export function isNonPublicIp(ip: string): boolean {
  const s = ip.trim().replace(/^\[|\]$/g, "");
  const v4 = ipv4Octets(s);
  if (v4) return isNonPublicV4(v4);
  if (s.includes("%")) return true; // zone IDs are link-scoped
  const w = parseIpv6(s);
  if (!w) return true;
  if (!inCidr6(w, [0x2000], 3)) return true; // only 2000::/3 is global unicast
  return NON_PUBLIC_V6_IN_GLOBAL.some(([p, bits]) => inCidr6(w, p, bits));
}

/**
 * Resolves the host over DNS-over-HTTPS and rejects it when any A/AAAA answer is
 * non-public or nothing resolves. Runs on every hop immediately before fetch.
 */
export async function assertResolvesPublic(host: string, signal: AbortSignal): Promise<void> {
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
    let body: { Status?: number; Answer?: { type: number; data: string }[] };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new Error("We couldn't reach that calendar link");
    }
    // Any non-NOERROR status for either family means the address set is unknown.
    if (body.Status !== 0) throw new Error("We couldn't reach that calendar link");
    for (const ans of body.Answer ?? []) {
      if (ans.type === 1 || ans.type === 28) addresses.push(String(ans.data ?? "").trim());
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
