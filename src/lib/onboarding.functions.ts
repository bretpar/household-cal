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
    const result = await createHousehold(supabaseAdmin as unknown as Db, context.userId, data.name);
    return { ...result, user_id: context.userId };
  });

export const saveHouseholdMembersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { members: unknown; removed_member_ids?: string[] }) => {
    const removed = data?.removed_member_ids ?? [];
    if (!Array.isArray(removed) || removed.some((id) => typeof id !== "string" || !id.trim())) {
      throw new Error("Invalid removed family members");
    }
    return { members: normalizeMembers(data?.members), removed_member_ids: removed };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return saveOnboardingMembers(supabaseAdmin as unknown as Db, context.userId, data.members, data.removed_member_ids);
  });
