/**
 * Server-to-server authentication for the two scheduled jobs.
 *
 * One secret, one place: `public.scheduler_credentials` is readable only by the
 * service role. The database scheduler reads it when it builds the request and
 * the app reads it with the service-role client when it verifies the request, so
 * there is nothing to keep in sync by hand and no runtime env copy.
 *
 * Failure modes stay distinguishable:
 *   - missing/incorrect token  -> 401 Unauthorized
 *   - secret unreadable/absent -> 500 (configuration problem, never a 401)
 *
 * Tokens and Authorization headers are never logged.
 */

const CREDENTIAL_NAME = "scheduler";

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Returns null when the caller is the authorized scheduler, otherwise the
 * Response to return directly.
 */
export async function authenticateSchedulerRequest(request: Request): Promise<Response | null> {
  const token = bearerToken(request);
  if (!token) {
    console.warn("[scheduler] rejected request without a bearer token");
    return new Response("Unauthorized", { status: 401 });
  }

  let expected: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("scheduler_credentials" as never)
      .select("token")
      .eq("name", CREDENTIAL_NAME)
      .maybeSingle();
    if (error) {
      console.error("[scheduler] could not read the scheduler credential:", error.message);
      return new Response("Scheduler credential unavailable", { status: 500 });
    }
    expected = ((data as { token?: string } | null)?.token ?? null) || null;
  } catch (error) {
    console.error(
      "[scheduler] credential lookup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response("Scheduler credential unavailable", { status: 500 });
  }

  if (!expected) {
    console.error("[scheduler] no scheduler credential is configured");
    return new Response("Scheduler credential not configured", { status: 500 });
  }

  if (!constantTimeEquals(token, expected)) {
    console.warn("[scheduler] rejected request with a token that does not match");
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

type RunStatus = "ok" | "failed";

/**
 * Records one scheduled run so a failure is visible without reading HTTP logs.
 * Observability only: a recording problem never changes the job's outcome.
 */
export async function recordSchedulerRun(
  job: string,
  status: RunStatus,
  detail?: string,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("scheduler_runs" as never)
      .insert({ job_name: job, status, detail: detail ?? null } as never);
  } catch {
    console.error("[scheduler] could not record run outcome for", job);
  }
}

/** Runs a scheduled handler with uniform logging, status codes and run records. */
export async function runScheduledJob(
  job: string,
  request: Request,
  handler: () => Promise<unknown>,
): Promise<Response> {
  const denied = await authenticateSchedulerRequest(request);
  if (denied) return denied;

  console.log(`[scheduler] ${job}: handler started`);
  try {
    const result = await handler();
    console.log(`[scheduler] ${job}: handler succeeded`);
    await recordSchedulerRun(job, "ok");
    return Response.json({ job, ok: true, result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`[scheduler] ${job}: handler failed:`, detail);
    await recordSchedulerRun(job, "failed", detail);
    return Response.json({ job, ok: false, error: detail }, { status: 500 });
  }
}
