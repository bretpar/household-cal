/**
 * Resolves the app origin used for OAuth return URLs from an allowlist only.
 * Caller-supplied Host / X-Forwarded-Host values never pick an arbitrary site.
 */
const FIXED_HOSTS = new Set([
  "ourfamilycalendar.com",
  "www.ourfamilycalendar.com",
  "our-fam-cal.lovable.app",
]);
const PROJECT_ID = "59a26a17-1a46-4d37-bcef-754fd9db6154";

export function isAllowedAppHost(host: string): boolean {
  const h = host.toLowerCase();
  if (FIXED_HOSTS.has(h)) return true;
  // Lovable preview / sandbox hosts belonging to this project only.
  if (h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com") || h.endsWith(".lovable.dev")) {
    const label = h.split(".")[0] ?? "";
    return label.includes(PROJECT_ID);
  }
  return false;
}

export function trustedAppOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwarded = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  const candidate = (forwarded ?? url.host).split(",")[0]?.trim() ?? "";
  if (/^[a-z0-9.-]+$/i.test(candidate) && isAllowedAppHost(candidate)) return `https://${candidate}`;
  return "https://ourfamilycalendar.com";
}
