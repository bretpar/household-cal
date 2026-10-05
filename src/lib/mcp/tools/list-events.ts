import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_events",
  title: "List events",
  description:
    "List household events overlapping a date range. Recurring series are returned once with their recurrence rule.",
  inputSchema: {
    household_id: z.string().uuid().describe("Household id from list_households."),
    from: z.string().datetime({ offset: true }).describe("Range start (ISO 8601)."),
    to: z.string().datetime({ offset: true }).describe("Range end (ISO 8601)."),
    calendar_id: z.string().uuid().optional().describe("Only events from this calendar."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ household_id, from, to, calendar_id }, ctx) => {
    if (new Date(to) <= new Date(from)) throw new ToolError("`to` must be after `from`");
    let q = supabaseForUser(ctx)
      .from("events")
      .select("id, title, start_at, end_at, all_day, location, notes, recurrence_rule, recurrence_until, excluded_dates, calendar_source_id")
      .eq("family_id", household_id)
      .lt("start_at", to)
      .or(`end_at.gt.${from},recurrence_rule.not.is.null`)
      .order("start_at")
      .limit(500);
    if (calendar_id) q = q.eq("calendar_source_id", calendar_id);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const events = (data ?? [])
      .filter((e) => !e.recurrence_rule || !e.recurrence_until || e.recurrence_until >= from.slice(0, 10))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day: e.all_day,
        location: e.location,
        notes: e.notes,
        calendar_id: e.calendar_source_id,
        recurrence_rule: e.recurrence_rule,
        recurrence_until: e.recurrence_until,
        excluded_dates: [...e.excluded_dates],
      }));
    return { content: [{ type: "text", text: JSON.stringify(events) }], structuredContent: { events } };
  },
});
