import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DeletionDb, HouseholdDeletionPlan } from "@/lib/account-deletion.server";

const requestSchema = z.object({
  transfers: z.record(z.string().uuid(), z.string().uuid()).optional(),
  delete_households: z.array(z.string().uuid()).max(50).optional(),
});

export const getAccountDeletionPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HouseholdDeletionPlan[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { planAccountDeletion } = await import("@/lib/account-deletion.server");
    return planAccountDeletion(supabaseAdmin as unknown as DeletionDb, context.userId);
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteAccount } = await import("@/lib/account-deletion.server");
    return deleteAccount(supabaseAdmin as unknown as DeletionDb, context.userId, data, {
      readGoogleKey: async (familyId) => {
        const { existingConnectionKey } = await import("@/lib/google-settings.server");
        return existingConnectionKey(familyId);
      },
      revokeGoogle: async (connectionAPIKey) => {
        const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
        const { GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
        return disconnectAppUser({ gatewayBaseUrl: GATEWAY_BASE_URL, connectionAPIKey, connectorId: "google_calendar" });
      },
    });
  });
