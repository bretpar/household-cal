import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authorizeQaCaller,
  resetQaHousehold,
  type AdminDb,
  type QaAuthorization,
  type QaResetSummary,
} from "@/lib/qa-reset.server";

/** Is the signed-in user allowed to see and run the QA reset? */
export const getQaAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QaAuthorization> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return authorizeQaCaller(supabaseAdmin as unknown as AdminDb, context.userId);
  });

/** Restores the dedicated Parker Family QA baseline. QA owner accounts only. */
export const runQaReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { confirm: string }) => {
    if (String(data?.confirm ?? "").trim().toUpperCase() !== "RESET") {
      throw new Error('Type RESET to confirm');
    }
    return { confirm: "RESET" as const };
  })
  .handler(async ({ context }): Promise<QaResetSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const summary = await resetQaHousehold(supabaseAdmin as unknown as AdminDb, context.userId);
    if (summary.google_calendars_preserved > 0) {
      // the reset cleared local test data, so re-import whatever Google still holds
      const { pullHousehold } = await import("@/lib/google/sync.server");
      await pullHousehold(supabaseAdmin, summary.family_id, true);
    }
    return summary;
  });
