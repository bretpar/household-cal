/**
 * Google sign-in for the iOS app shell.
 *
 * Google blocks OAuth inside embedded web views, so in the native app we:
 *  1. open /native-google-auth in the system browser (SFSafariViewController)
 *     with a one-time random `state`,
 *  2. that page runs the normal Lovable Cloud Google sign-in there,
 *  3. then hands the session back via the app's URL scheme
 *     (com.ourfamilycalendar.app://auth-callback#state=…&access_token=…&refresh_token=…),
 *  4. the app verifies `state`, closes the browser and calls setSession().
 *
 * On the web none of this runs: isNativeApp() is false and the existing flow is used.
 */
import { Capacitor } from "@capacitor/core";

import { supabase } from "@/integrations/supabase/client";

export const NATIVE_AUTH_SCHEME = "com.ourfamilycalendar.app";
export const NATIVE_AUTH_CALLBACK = `${NATIVE_AUTH_SCHEME}://auth-callback`;
const WEB_ORIGIN = "https://ourfamilycalendar.com";
const STATE_KEY = "ofc-native-google-state";
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function isValidNativeState(state: unknown): state is string {
  return typeof state === "string" && STATE_PATTERN.test(state);
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function startNativeGoogleSignIn(): Promise<void> {
  const state = randomState();
  localStorage.setItem(STATE_KEY, state);
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({
    url: `${WEB_ORIGIN}/native-google-auth?state=${state}`,
    presentationStyle: "popover",
  });
}

let listenerInstalled = false;

/** Install once at app start (native only). Resolves the handoff back from the browser. */
export async function installNativeAuthListener(onSignedIn: () => void): Promise<void> {
  if (!isNativeApp() || listenerInstalled) return;
  listenerInstalled = true;
  const [{ App }, { Browser }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/browser"),
  ]);
  await App.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
    await Browser.close().catch(() => {});
    const params = new URLSearchParams(url.split("#")[1] ?? "");
    const expected = localStorage.getItem(STATE_KEY);
    localStorage.removeItem(STATE_KEY);
    const state = params.get("state");
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!expected || state !== expected || !access_token || !refresh_token) {
      console.warn("[native-auth] Ignored sign-in callback with invalid state");
      return;
    }
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      console.error("[native-auth] setSession failed", error);
      return;
    }
    onSignedIn();
  });
}
