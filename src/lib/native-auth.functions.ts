import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const b64 = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`));

export const startNativeHandoff = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ challenge: b64(43, 43) }).parse(d))
  .handler(async ({ data }) => {
    const { startHandoff } = await import("./native-auth.server");
    return startHandoff(data.challenge);
  });

export const completeNativeHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ requestId: z.string().uuid(), refreshToken: z.string().min(1).max(512) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { completeHandoff } = await import("./native-auth.server");
    return completeHandoff({
      requestId: data.requestId,
      refreshToken: data.refreshToken,
      userId: context.userId,
      claims: context.claims as Record<string, unknown>,
    });
  });

export const redeemNativeHandoff = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: b64(43, 43), verifier: b64(43, 128) }).parse(d))
  .handler(async ({ data }) => {
    const { redeemHandoff } = await import("./native-auth.server");
    return redeemHandoff(data.code, data.verifier);
  });
