import { supabase } from "@/integrations/supabase/client";
import { ensureFamilyMembership } from "@/lib/calendar.functions";
import { withTimeout } from "@/lib/with-timeout";

const AUTH_TIMEOUT_MS = 10_000;

// Set once the layout has mounted in the browser. On the very first page load
// the guard must NOT redirect inside beforeLoad: the server streamed the shell
// for the originally requested URL, and a redirect processed before hydration
// makes the client render a different tree than the streamed HTML (React
// hydration error #418), which regenerates the whole tree and races any input
// on the target page. Deferring the initial check to a post-mount effect keeps
// hydration identical to the server shell; later client-side navigations are
// still fully gated by beforeLoad.
let hasMountedOnce = false;

/**
 * Last passed guard result for the signed-in user. Ordinary tab navigation
 * reuses it instead of re-running the auth + household round-trips. Only
 * results with a household are cached (so onboarding/invite claims always
 * re-check), and any auth change (sign-in, sign-out, user switch) clears it.
 */
const GUARD_TTL_MS = 5 * 60_000;
let guardCache: { userId: string; family_id: string; at: number; user: unknown } | null = null;
/** Membership verified by the last guard pass (cleared on any auth change). */
let verifiedMembership: { userId: string; family_id: string; role: string | null } | null = null;
export function getVerifiedMembership() {
  return verifiedMembership;
}
let guardInFlight: { pathname: string; promise: ReturnType<typeof resolveGuardUncached> } | null =
  null;
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") {
      guardCache = null;
      verifiedMembership = null;
    }
  });
}

export async function resolveGuard(pathname: string) {
  const onOnboarding = pathname.startsWith("/onboarding");
  if (guardCache && !onOnboarding && Date.now() - guardCache.at < GUARD_TTL_MS) {
    // Local session read only (no network); confirms the same user is still signed in.
    const { data } = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, "Session");
    if (data.session?.user.id === guardCache.userId) {
      return { user: guardCache.user as NonNullable<typeof data.session>["user"], family_id: guardCache.family_id };
    }
    guardCache = null;
  }
  // Share one in-flight check between beforeLoad and the mount effect.
  if (guardInFlight?.pathname === pathname) return guardInFlight.promise;
  const promise = resolveGuardUncached(pathname);
  guardInFlight = { pathname, promise };
  try {
    const result = await promise;
    if ("family_id" in result && result.family_id && result.user) {
      guardCache = { userId: result.user.id, family_id: result.family_id, at: Date.now(), user: result.user };
    }
    return result;
  } finally {
    if (guardInFlight?.promise === promise) guardInFlight = null;
  }
}

/**
 * Warm resume: drop a possibly-stuck in-flight check and the cached result so
 * the next guard run starts fresh. Does not sign anyone out.
 */
export function resetGuardForResume() {
  guardInFlight = null;
  guardCache = null;
}

async function currentUser() {
  try {
    const { data, error } = await withTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS, "Auth");
    return error ? null : data.user;
  } catch {
    // Network stalled (e.g. right after an iOS resume): fall back to the
    // locally stored session; server functions still verify the token.
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS, "Session");
      return data.session?.user ?? null;
    } catch {
      return null;
    }
  }
}

async function resolveGuardUncached(pathname: string) {
  const user = await currentUser();
  if (!user) return { redirectTo: "/auth" as const };
  const data = { user };

  // resolves an existing membership or claims a pending invitation; brand-new
  // users get no household and are sent to onboarding to create their own.
  // A failed lookup must NOT be treated as "no household" — keep established
  // users in the app instead of bouncing them through onboarding.
  const onOnboarding = pathname.startsWith("/onboarding");
  let resolved: { family_id: string | null; role?: string | null } | undefined;
  try {
    resolved = await withTimeout(ensureFamilyMembership(), AUTH_TIMEOUT_MS, "Household");
  } catch {
    // leave `resolved` undefined so the error path below keeps the user in-app
  }

  if (resolved) {
    if (!resolved.family_id && !onOnboarding) return { redirectTo: "/onboarding" as const };
    if (resolved.family_id && onOnboarding) return { redirectTo: "/calendar" as const };
    verifiedMembership = resolved.family_id
      ? { userId: user.id, family_id: resolved.family_id, role: resolved.role ?? null }
      : null;
    return { user: data.user, family_id: resolved.family_id };
  }

  // The server membership check failed. Fail closed only when we can confirm
  // the account truly has no household: read the caller's own membership rows
  // (the family_users SELECT policy allows user_id = auth.uid()). A confirmed
  // household-less account must not land on an empty calendar; if this read
  // also fails, the state is genuinely unknown, so keep the user in-app
  // rather than bouncing an established household through onboarding on a
  // transient error.
  if (!onOnboarding) {
    const { data: memberships, error: membershipError } = await withTimeout(
      Promise.resolve(
        supabase.from("family_users").select("family_id").eq("user_id", data.user.id).limit(1),
      ),
      AUTH_TIMEOUT_MS,
      "Membership",
    ).catch(() => ({ data: null, error: new Error("timeout") }));
    if (!membershipError && (memberships?.length ?? 0) === 0) {
      return { redirectTo: "/onboarding" as const };
    }
  }
  return { user: data.user };
}

/** Called by the layout after its first browser mount. */
export function markLayoutMounted() {
  hasMountedOnce = true;
}

export function hasLayoutMounted() {
  return hasMountedOnce;
}
