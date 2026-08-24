import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createHousehold,
  loadOnboardingStatus,
  normalizeMembers,
  saveOnboardingMembers,
  type Db,
  type OnboardingStatus,
} from "@/lib/onboarding.server";

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOnboardingStatus(supabaseAdmin as unknown as Db, context.userId);
  });

export const createHouseholdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string }) => ({ name: String(data?.name ?? "") }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createHousehold(supabaseAdmin as unknown as Db, context.userId, data.name);
  });

export const saveHouseholdMembersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { members: unknown }) => ({ members: normalizeMembers(data?.members) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return saveOnboardingMembers(supabaseAdmin as unknown as Db, context.userId, data.members);
  });
