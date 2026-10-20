import { createServerFn } from "@tanstack/react-start";

export type EmailAuthStatus = "not_found" | "password" | "google";

/**
 * Email-first sign-in: reports whether an account exists and how it signs in.
 * Public by design (the user chose a Google/Slack-style flow); returns only a status.
 */
export const checkEmailAuthStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => {
    const email = String(input?.email ?? "").trim().toLowerCase();
    if (!email || email.length > 320 || !email.includes("@")) throw new Error("Enter a valid email");
    return { email };
  })
  .handler(async ({ data }): Promise<{ status: EmailAuthStatus }> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Sign-in is unavailable right now");

    // Ad-hoc limit: 10 lookups per 10 minutes per visitor IP.
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip =
      getRequestHeader("cf-connecting-ip") ||
      (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
      "unknown";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: allowed, error: rlError } = await supabaseAdmin.rpc("consume_auth_lookup", {
      _bucket: `ip:${ip}`,
      _max: 10,
      _window_seconds: 600,
    });
    if (rlError) throw new Error("Sign-in is unavailable right now");
    if (!allowed) throw new Error("Too many attempts. Please wait a few minutes and try again.");

    const res = await fetch(
      `${url}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(data.email)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error("Sign-in is unavailable right now");
    const body = (await res.json()) as {
      users?: Array<{ email?: string; identities?: Array<{ provider?: string }>; app_metadata?: { providers?: string[] } }>;
    };
    const user = body.users?.find((u) => (u.email ?? "").toLowerCase() === data.email);
    if (!user) return { status: "not_found" };
    const providers = new Set<string>([
      ...(user.app_metadata?.providers ?? []),
      ...(user.identities ?? []).map((i) => i.provider ?? ""),
    ]);
    if (providers.has("google") && !providers.has("email")) return { status: "google" };
    return { status: "password" };
  });
