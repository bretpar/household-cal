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
    if (b.date ? a.date !== b.date : !a.dateTime || Date.parse(a.dateTime) !== Date.parse(b.dateTime) || a.timeZone !== b.timeZone) return false;
  }
  if (Object.hasOwn(body, "recurrence")) {
    if (JSON.stringify([...(remote['recurrence'] ?? [])].sort()) !== JSON.stringify([...(body['recurrence'] ?? [])].sort())) return false;
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
  return JSON.stringify([...(remote['recurrence'] ?? [])].sort()) === JSON.stringify([...(body['recurrence'] ?? [])].sort());
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