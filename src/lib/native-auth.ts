/**
 * Google sign-in for the iOS app shell (PKCE-style handoff; no tokens in URLs).
 *
 *  1. App creates a random verifier + state, registers sha256(verifier) with the server
 *     and opens /native-google-auth?request=…&state=… in the system browser.
 *  2. That page forces a fresh Google sign-in and gets a one-time code bound to the request.
 *  3. The browser returns to the app with only ?code=…&state=… (Universal Link, or the
 *     custom scheme as fallback). The code is worthless without the verifier.
 *  4. The app validates the URL exactly, checks state/expiry, consumes its pending record,
 *     and redeems code + verifier over HTTPS for a session.
 *
 * On the web none of this runs: isNativeApp() is false.
 */
import { Capacitor } from "@capacitor/core";

import { supabase } from "@/integrations/supabase/client";
import { redeemNativeHandoff, startNativeHandoff } from "@/lib/native-auth.functions";

export const NATIVE_AUTH_SCHEME = "com.ourfamilycalendar.app";
export const NATIVE_AUTH_SCHEME_CALLBACK = `${NATIVE_AUTH_SCHEME}://auth-callback`;
/** Universal Link return (different host from the sign-in page so Safari hands off on tap). */
export const NATIVE_AUTH_UNIVERSAL_CALLBACK = "https://ourfamilycalendar.com/native-auth/callback";
const UNIVERSAL_HOSTS = new Set(["www.ourfamilycalendar.com", "ourfamilycalendar.com"]);
const WEB_ORIGIN = "https://ourfamilycalendar.com";
const PENDING_KEY = "ofc-native-google-pending";
const PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export const isValidNativeState = (v: unknown): v is string => typeof v === "string" && STATE_PATTERN.test(v);
export const isValidRequestId = (v: unknown): v is string => typeof v === "string" && UUID_PATTERN.test(v);
export const isValidHandoffCode = (v: unknown): v is string => typeof v === "string" && TOKEN_PATTERN.test(v);

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

type Pending = { state: string; verifier: string; expiresAt: number };

export async function startNativeGoogleSignIn(): Promise<void> {
  const verifier = random();
  const state = random();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const { requestId } = await startNativeHandoff({ data: { challenge } });
  const pending: Pending = { state, verifier, expiresAt: Date.now() + PENDING_TTL_MS };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const { Browser } = await import("@capacitor/browser");
  const url = new URL("/native-google-auth", WEB_ORIGIN);
  url.searchParams.set("request", requestId);
  url.searchParams.set("state", state);
  await Browser.open({ url: url.toString(), presentationStyle: "popover" });
}

/** Exact parse of an incoming return URL. Returns code+state or null. */
export function parseNativeCallback(raw: string): { code: string; state: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const isScheme =
    u.protocol === `${NATIVE_AUTH_SCHEME}:` && u.host === "auth-callback" && (u.pathname === "" || u.pathname === "/");
  const isUniversal =
    u.protocol === "https:" && UNIVERSAL_HOSTS.has(u.host) && u.pathname === "/native-auth/callback" && !u.port;
  if (!isScheme && !isUniversal) return null;
  if (u.username || u.password || u.hash) return null;
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 2) return null;
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!isValidHandoffCode(code) || !isValidNativeState(state)) return null;
  return { code, state };
}

/** Read the pending attempt without consuming it. Returns null when absent, corrupt, or expired. */
function peekPending(): Pending | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Pending;
    if (!isValidNativeState(p.state) || typeof p.verifier !== "string" || !(p.expiresAt > Date.now())) return null;
    return p;
  } catch {
    return null;
  }
}

/** Single-use consumption of the pending attempt. Only called once the callback state has matched. */
function consumePending(): Pending | null {
  const pending = peekPending();
  localStorage.removeItem(PENDING_KEY);
  return pending;
}

let listenerInstalled = false;
/** Last callback URL accepted for processing; guards against double delivery. */
let lastHandledUrl: string | null = null;

type Stage = "callback" | "redeem" | "set_session" | "navigate";
/** Sanitized diagnostics: stage + safe error name/code/status only. Never URLs, codes, state or tokens. */
function logStage(stage: Stage, err: unknown) {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; status?: unknown };
  console.error("[native-auth] stage failed", {
    stage,
    name: typeof e.name === "string" ? e.name : typeof err,
    code: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined,
    status: typeof e.status === "number" ? e.status : undefined,
  });
}

export async function installNativeAuthListener(
  onSignedIn: () => void,
  onError: (message: string) => void = () => {},
): Promise<void> {
  if (!isNativeApp() || listenerInstalled) return;
  listenerInstalled = true;
  const [{ App }, { Browser }] = await Promise.all([import("@capacitor/app"), import("@capacitor/browser")]);
  const RETRY = "Sign-in didn't finish. Please tap Continue with Google to try again.";

  const handleCallback = async (url: string | undefined | null): Promise<void> => {
    if (!url || url === lastHandledUrl) return;
    const parsed = parseNativeCallback(url);
    if (!parsed) return;
    // Peek without consuming: a callback with the wrong state must not destroy
    // the legitimate pending sign-in attempt it will never match.
    const pending = peekPending();
    if (!pending || pending.state !== parsed.state) {
      console.warn("[native-auth] stage=callback ignored: no matching pending attempt");
      return;
    }
    lastHandledUrl = url; // claim only accepted callbacks, so a stray URL can't block a valid one
    await Browser.close().catch(() => {});
    // Consume before redeeming: once the request is sent the server's single-use code may be
    // spent, so the attempt must never be replayed (a second delivery finds nothing here).
    const consumed = consumePending();
    if (!consumed || consumed.state !== parsed.state) return;

    let tokens: { access_token: string; refresh_token: string };
    try {
      tokens = await redeemNativeHandoff({ data: { code: parsed.code, verifier: consumed.verifier } });
      if (!tokens?.access_token || !tokens?.refresh_token) throw new Error("bad_redeem_shape");
    } catch (err) {
      // Failed or ambiguous: the code may already be consumed server-side. Never replay it.
      logStage("redeem", err);
      onError(RETRY);
      return;
    }

    // Redeemed: tokens live only in memory. One retry for a transient setSession failure.
    let setErr: unknown = null;
    for (let i = 0; i < 2; i++) {
      const { error } = await supabase.auth.setSession(tokens).catch((e) => ({ error: e }));
      setErr = error;
      if (!error) break;
    }
    if (setErr) {
      logStage("set_session", setErr);
      onError(RETRY);
      return;
    }
    try {
      onSignedIn();
    } catch (err) {
      logStage("navigate", err);
      onError("You're signed in, but the app couldn't open your calendar. Please reopen the app.");
    }
  };

  const safeHandle = (url: string | undefined | null) =>
    handleCallback(url).catch((err) => {
      logStage("callback", err);
      onError(RETRY);
    });

  await App.addListener("appUrlOpen", ({ url }) => {
    void safeHandle(url);
  });

  // Cold launch: the scene delegate may have forwarded the link before the
  // listener was registered. Capacitor retains it as the launch URL.
  try {
    const launch = await App.getLaunchUrl();
    await safeHandle(launch?.url);
  } catch (err) {
    logStage("callback", err);
  }
}
