/**
 * Shared authentication for scheduled (cron) endpoints.
 *
 * The scheduler token lives in one place only: an encrypted database secret.
 * pg_cron reads it at execution time to build the Authorization header, and the
 * app verifies the presented token through a boolean-only SECURITY DEFINER RPC
 * that never returns the stored value. Lovable's platform cron secret remains an
 * optional fallback for platform-triggered runs.
 *
 * Tokens and Authorization headers are never logged.
 */

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/**
 * Returns null when the caller is an authorized scheduler, otherwise a Response
 * to return directly.
 */
export async function authenticateSchedulerRequest(request: Request): Promise<Response | null> {
  const token = bearerToken(request);

  if (token) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("verify_scheduler_token" as never, {
        _token: token,
      } as never);
      if (!error && data === true) return null;
    } catch {
      // Fall through to the platform cron secret below.
    }
  }

  // Optional fallback: platform-managed cron path.
  return authenticateCronRequest(request);
}
