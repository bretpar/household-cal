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

/** Google permits lowercase base32hex ids; hex SHA-256 is a valid subset. */
export async function deliveryRemoteId(key: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}