import { createHash } from "node:crypto";
import { encryptConnectionKey } from "@/lib/google/crypto.server";

export const oauthChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");

/** The callback has no app session: only the secret bound at authenticated start may deposit a code. */
export async function receiveCaregiverOAuth(params: URLSearchParams) {
  const attempt = params.get("attempt");
  const secret = params.get("state");
  if (!attempt || !/^[0-9a-f-]{36}$/i.test(attempt) || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Invalid authorization return");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await db.from("caregiver_google_oauth_attempts").select("id,mode")
    .eq("id", attempt).eq("return_secret", secret).is("consumed_at", null).gt("expires_at", new Date().toISOString()).single();
  if (error || !row) throw new Error("Authorization return expired");
  const code = params.get("code");
  const success = params.get("success") === "true" && params.get("connector_id") === "google_calendar" && !!code && code.length <= 4096;
  if (success && code) {
    const { data: saved, error: saveError } = await db.from("caregiver_google_oauth_attempts").update({ code_ciphertext: encryptConnectionKey(code) })
      .eq("id", attempt).eq("return_secret", secret).is("consumed_at", null).is("code_ciphertext", null).gt("expires_at", new Date().toISOString()).select("id").single();
    if (saveError || !saved) throw new Error("Authorization return already received");
  }
  return { attempt, state: secret, native: row.mode === "native", success };
}