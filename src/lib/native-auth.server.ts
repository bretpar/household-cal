/**
 * Server side of the iOS Google sign-in handoff (PKCE-style, single-use code).
 *
 * 1. start:    app registers challenge = base64url(sha256(verifier)); gets a request id.
 * 2. complete: the Safari page, after a *fresh* Google sign-in, binds that request to the
 *              user and receives a one-time code (only its hash is stored).
 * 3. redeem:   the app presents code + verifier over HTTPS; the server checks both, consumes
 *              the row atomically and returns a newly minted session in the response body.
 * No token ever travels in a URL.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { decryptConnectionKey, encryptConnectionKey } from "@/lib/google/crypto.server";

const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest();

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function publicAuthClient() {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function mintSession(refreshToken: string) {
  const { data, error } = await publicAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) throw new Error("Session could not be issued");
  return data.session;
}

export async function startHandoff(challenge: string): Promise<{ requestId: string }> {
  const db = await admin();
  await db.from("native_auth_handoffs").delete().lt("expires_at", new Date().toISOString());
  const { data, error } = await db
    .from("native_auth_handoffs")
    .insert({ challenge, expires_at: new Date(Date.now() + REQUEST_TTL_MS).toISOString() })
    .select("id")
    .single();
  if (error || !data) {
    // TEMPORARY diagnostic (non-secret): key type only, never the key itself.
    const k = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    console.error("[native-auth] startHandoff insert failed", {
      code: error?.code,
      message: error?.message,
      serviceKeyPresent: k.length > 0,
      serviceKeyType: k.startsWith("sb_secret_") ? "sb_secret" : k.startsWith("sb_publishable_") ? "PUBLISHABLE(wrong)" : k.startsWith("eyJ") ? "jwt" : "unknown",
      sameAsPublishable: k.length > 0 && k === process.env["SUPABASE_PUBLISHABLE_KEY"],
      urlPresent: Boolean(process.env["SUPABASE_URL"]),
    });
    throw new Error("Could not start sign-in");
  }
  return { requestId: data.id };
}

/** Latest oauth sign-in time (seconds) from the JWT `amr` claim. */
function oauthSignInTime(claims: Record<string, unknown>): number {
  const amr = Array.isArray(claims["amr"]) ? (claims["amr"] as Array<Record<string, unknown>>) : [];
  return Math.max(
    0,
    ...amr
      .filter((a) => a["method"] === "oauth" && typeof a["timestamp"] === "number")
      .map((a) => a["timestamp"] as number),
  );
}

export async function completeHandoff(args: {
  requestId: string;
  refreshToken: string;
  userId: string;
  claims: Record<string, unknown>;
}): Promise<{ code: string }> {
  const db = await admin();
  const { data: row } = await db
    .from("native_auth_handoffs")
    .select("id, created_at, expires_at, completed_at")
    .eq("id", args.requestId)
    .maybeSingle();
  if (!row || row.completed_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error("Sign-in request expired");
  }
  // Must be a Google sign-in performed after this request was created — an older
  // browser session cannot be packaged for the app.
  const createdSec = Math.floor(new Date(row.created_at).getTime() / 1000) - 5;
  if (oauthSignInTime(args.claims) < createdSec) throw new Error("Fresh sign-in required");

  // Rotate the browser's refresh token server-side; confirms it belongs to this user.
  const session = await mintSession(args.refreshToken);
  if (session.user.id !== args.userId) throw new Error("Session mismatch");

  const code = b64url(randomBytes(32));
  const { data: updated } = await db
    .from("native_auth_handoffs")
    .update({
      user_id: args.userId,
      code_hash: sha256(code).toString("hex"),
      code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      refresh_token_enc: encryptConnectionKey(session.refresh_token),
      completed_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .is("completed_at", null)
    .select("id");
  if (!updated?.length) throw new Error("Sign-in request already used");
  return { code };
}

export async function redeemHandoff(code: string, verifier: string) {
  const db = await admin();
  const nowIso = new Date().toISOString();
  // Atomic single-use consume.
  const { data: rows } = await db
    .from("native_auth_handoffs")
    .update({ consumed_at: nowIso })
    .eq("code_hash", sha256(code).toString("hex"))
    .is("consumed_at", null)
    .gt("code_expires_at", nowIso)
    .select("id, challenge, user_id, refresh_token_enc");
  const row = rows?.[0];
  if (!row) throw new Error("Invalid or expired code");
  // Scrub the stored credential regardless of outcome.
  await db.from("native_auth_handoffs").update({ refresh_token_enc: null }).eq("id", row.id);

  const expected = Buffer.from(row.challenge);
  const actual = Buffer.from(b64url(sha256(verifier)));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || !row.refresh_token_enc) {
    throw new Error("Invalid or expired code");
  }
  const session = await mintSession(decryptConnectionKey(row.refresh_token_enc));
  if (session.user.id !== row.user_id) throw new Error("Session mismatch");
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}
