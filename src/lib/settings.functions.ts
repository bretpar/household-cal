import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Db } from "@/lib/calendar-ops";
import {
  createCategory,
  deleteCategory,
  reorderCategories,
  saveFamilyMember,
  seedDefaultCategories,
  updateCategory,
  type FamilyMemberInput,
} from "@/lib/settings.server";

export const createEventCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; color: string }) => ({
    name: String(data.name ?? ""),
    color: String(data.color ?? ""),
  }))
  .handler(({ data, context }) =>
    createCategory(context.supabase as unknown as Db, context.userId, data),
  );

export const updateEventCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name?: string; color?: string }) => data)
  .handler(async ({ data, context }) => {
    await updateCategory(context.supabase as unknown as Db, context.userId, data);
    return { ok: true };
  });

export const deleteEventCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data.id ?? "") }))
  .handler(async ({ data, context }) => {
    await deleteCategory(context.supabase as unknown as Db, context.userId, data.id);
    return { ok: true };
  });

export const reorderEventCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) => ({ ids: (data.ids ?? []).map(String) }))
  .handler(async ({ data, context }) => {
    await reorderCategories(context.supabase as unknown as Db, context.userId, data.ids);
    return { ok: true };
  });

export const addStarterCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    seedDefaultCategories(context.supabase as unknown as Db, context.userId),
  );

export const saveFamilyMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: FamilyMemberInput) => data)
  .handler(({ data, context }) =>
    saveFamilyMember(context.supabase as unknown as Db, context.userId, data),
  );
