import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Db } from "@/lib/calendar-ops";
import {
  deleteRecipient,
  deleteSchedule,
  loadEmailSummaries,
  loadOwnedSchedule,
  saveHouseholdTimezone,
  saveRecipient,
  saveSchedule,
  setScheduleEnabled,
} from "@/lib/email-summaries/settings.server";

export const getEmailSummarySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadEmailSummaries(
      context.supabase as unknown as Db,
      supabaseAdmin as never,
      context.userId,
    );
  });


export const saveEmailSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string | null;
      name: string;
      frequency: string;
      send_time: string;
      enabled?: boolean;
    }) => data,
  )
  .handler(({ data, context }) =>
    saveSchedule(context.supabase as unknown as Db, context.userId, data),
  );

export const setEmailScheduleEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; enabled: boolean }) => data)
  .handler(async ({ data, context }) => {
    await setScheduleEnabled(
      context.supabase as unknown as Db,
      context.userId,
      data.id,
      Boolean(data.enabled),
    );
    return { ok: true };
  });

export const deleteEmailSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await deleteSchedule(context.supabase as unknown as Db, context.userId, data.id);
    return { ok: true };
  });

export const saveEmailRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string | null;
      schedule_id: string;
      name: string;
      email: string;
      family_member_id?: string | null;
      calendar_source_ids?: string[];
      weekdays?: string[] | null;
      resubscribe?: boolean;
    }) => data,
  )
  .handler(({ data, context }) =>
    saveRecipient(context.supabase as unknown as Db, context.userId, data),
  );

export const deleteEmailRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await deleteRecipient(context.supabase as unknown as Db, context.userId, data.id);
    return { ok: true };
  });

export const setHouseholdTimezone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { timezone: string }) => ({ timezone: String(data.timezone ?? "") }))
  .handler(async ({ data, context }) => {
    await saveHouseholdTimezone(context.supabase as unknown as Db, context.userId, data.timezone);
    return { ok: true };
  });

/** Sends the real summary email for the current period to the signed-in owner. */
export const sendEmailSummaryPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { schedule_id: string; recipient_id?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const schedule = await loadOwnedSchedule(db, context.userId, data.schedule_id);
    const to = (context.claims as { email?: string } | null)?.email;
    if (!to) throw new Error("Your account has no email address for previews");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendSummaryPreview } = await import("@/lib/email-summaries/dispatch.server");
    const result = await sendSummaryPreview(
      supabaseAdmin,
      schedule,
      data.recipient_id ?? null,
      to,
    );
    return { ...result, to };
  });

/** Public: unsubscribes one recipient from one schedule using their token. */
export const unsubscribeSummaryRecipient = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: String(data.token ?? "") }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { unsubscribeByToken } = await import("@/lib/email-summaries/dispatch.server");
    return unsubscribeByToken(supabaseAdmin, data.token);
  });
