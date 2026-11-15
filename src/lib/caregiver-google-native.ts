import { supabase } from "@/integrations/supabase/client";
import { completeCaregiverGoogle } from "@/lib/caregiver-google.functions";
import { NATIVE_AUTH_SCHEME, isValidNativeState, isValidRequestId } from "@/lib/native-auth";

const PENDING_KEY = "ofc-caregiver-google-pending";
type Pending = { userId: string; attempt: string; state: string; verifier: string; expiresAt: number };

export async function createCaregiverOAuthProof() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const verifier = encode(bytes);
  const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export async function openCaregiverNativeOAuth(pending: Omit<Pending, "expiresAt">, authorizationUrl: string) {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, expiresAt: Date.now() + 10 * 60 * 1000 }));
  const { Browser } = await import("@capacitor/browser");
  try { await Browser.open({ url: authorizationUrl, presentationStyle: "popover" }); }
  catch (error) { localStorage.removeItem(PENDING_KEY); throw error; }
}

/** Handled by the root listener, including cold launches; never establish a different app session. */
export async function handleCaregiverNativeOAuth(raw: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== `${NATIVE_AUTH_SCHEME}:` || url.host !== "caregiver-google-callback" || !["", "/"].includes(url.pathname)) return false;
  if (url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 3) return true;
  const attempt = url.searchParams.get("attempt");
  const state = url.searchParams.get("state");
  const success = url.searchParams.get("success");
  if (!isValidRequestId(attempt) || !isValidNativeState(state) || !["true", "false"].includes(success ?? "")) return true;
  let pending: Pending;
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null"); } catch { return true; }
  if (!pending || pending.attempt !== attempt || pending.state !== state || !isValidNativeState(pending.verifier) || pending.expiresAt <= Date.now()) return true;
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== pending.userId) {
    localStorage.removeItem(PENDING_KEY);
    throw new Error("Return to the caregiver account that started Google authorization and reconnect.");
  }
  localStorage.removeItem(PENDING_KEY);
  const { Browser } = await import("@capacitor/browser");
  await Browser.close().catch(() => {});
  if (success !== "true") throw new Error("Google Calendar did not finish connecting. Please try again.");
  await completeCaregiverGoogle({ data: { attempt, verifier: pending.verifier } });
  const { toast } = await import("sonner");
  toast.success("Google Calendar connected", { duration: 2000 });
  window.location.assign("/caregiver/settings");
  return true;
}