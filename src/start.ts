import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.handlerType === "serverFn" && !new URL(ctx.request.url).pathname.startsWith("/lovable/"),
});

/**
 * Rejects already-issued sign-in tokens of accounts that are being deleted, for
 * every server function (onboarding, household creation, everything). Only the
 * token's user id is read here; requireSupabaseAuth still verifies the token.
 * A forged id can only get its own request rejected.
 */
const deletingAccountGuard = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const match = /^Bearer\s+([\w-]+)\.([\w-]+)\.[\w-]+$/.exec(getRequestHeader("authorization") ?? "");
  if (match) {
    let sub: string | null = null;
    try {
      sub = JSON.parse(atob(match[2]!.replace(/-/g, "+").replace(/_/g, "/"))).sub ?? null;
    } catch {
      sub = null;
    }
    if (sub) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("account_deletion_blocked" as never, { _user_id: sub } as never);
      if (error) throw new Response("Service unavailable", { status: 503 });
      if (data === true) throw new Response("This account is being deleted", { status: 403 });
    }
  }
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, deletingAccountGuard],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
