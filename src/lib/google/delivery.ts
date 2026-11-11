import { localWallClock } from "./mapping";

/** Floating or offset dateTime -> wall clock in zone; offset-less values already are. */
function wallClock(value: string, timeZone: string | undefined): string {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (!hasOffset) return value.slice(0, 19);
  return timeZone ? localWallClock(value, timeZone) : new Date(value).toISOString().slice(0, 19);
}

/** Canonical recurrence: RRULE parts sorted, EXDATE/RDATE lists expanded per value, deduped. */
export function canonicalRecurrence(lines: unknown): string[] {
  const out = new Set<string>();
  for (const raw of Array.isArray(lines) ? lines : []) {
    for (const line of String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const idx = line.indexOf(":");
      if (idx < 0) { out.add(line.toUpperCase()); continue; }
      const head = line.slice(0, idx).toUpperCase();
      const value = line.slice(idx + 1).trim();
      const [name, ...params] = head.split(";");
      const paramKey = params.sort().join(";");
      if (name === "RRULE") {
        out.add("RRULE:" + value.toUpperCase().split(";").filter(Boolean).sort().join(";"));
      } else if (name === "EXDATE" || name === "RDATE") {
        for (const v of value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) out.add(`${name};${paramKey}:${v}`);
      } else {
        out.add(`${head}:${value}`);
      }
    }
  }
  return [...out].sort();
}

function sameRecurrence(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalRecurrence(a)) === JSON.stringify(canonicalRecurrence(b));
}

/** Remote identity/content checks shared by create, adoption and replay. */
export function remoteMatchesDelivery(remote: Record<string, any>, body: Record<string, any>, remoteId: string): boolean {
  if (remote['id'] !== remoteId || remote['status'] === "cancelled") return false;
  const expected = body['extendedProperties']?.private ?? {};
  const actual = remote['extendedProperties']?.private ?? {};
  if (Object.entries(expected).some(([key, value]) => actual[key] !== value)) return false;
  for (const key of ["summary", "description", "location"]) {
    if ((remote[key] ?? "") !== (body[key] ?? "")) return false;
  }
  for (const key of ["start", "end"]) {
    const a = remote[key], b = body[key];
    if (!a || !b) return false;
    if (b.date ? a.date !== b.date : !a.dateTime || a.timeZone !== b.timeZone || wallClock(a.dateTime, b.timeZone) !== wallClock(b.dateTime, b.timeZone)) return false;
  }
  if (Object.hasOwn(body, "recurrence")) {
    if (!sameRecurrence(remote['recurrence'], body['recurrence'])) return false;
  }
  return true;
}

/** Legacy identity is acceptable only with an unambiguous master/branch relationship. */
export function legacyMatchesBranch(remote: Record<string, any>, body: Record<string, any>): boolean {
  const expected = body['extendedProperties']?.private;
  const actual = remote['extendedProperties']?.private;
  if (!remote['id'] || remote['status'] === 'cancelled' || remote['recurringEventId'] || !actual || !expected) return false;
  if (actual['ofc_branch_key'] !== undefined || actual['ofc_event_id'] !== expected['ofc_event_id'] || actual['ofc_family_id'] !== expected['ofc_family_id']) return false;
  if (actual['ofc_source_id'] && actual['ofc_source_id'] !== expected['ofc_source_id']) return false;
  // Identity markers establish ownership; exact recurrence establishes branch,
  // never title/time similarity. Changed recurrence remains manual-review only.
  return sameRecurrence(remote['recurrence'], body['recurrence']);
}

export function uniqueLegacyBranch(matches: Record<string, any>[], body: Record<string, any>): string | null {
  const valid = matches.filter((remote) => legacyMatchesBranch(remote, body));
  if (valid.length > 1 || (matches.length > 0 && valid.length === 0)) throw new Error('Ambiguous legacy Google branch identity; insertion withheld');
  return valid[0]?.['id'] ?? null;
}

/** Google permits lowercase base32hex ids; hex SHA-256 is a valid subset. */
export async function deliveryRemoteId(key: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}