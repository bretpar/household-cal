import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { localDateKey, seriesCoversDate } from "../../google/occurrence";
import { supabaseForUser } from "../supabase";

interface RecurringRow {
  start_at: string;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates: string[] | null;
}

function dayKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** COUNT limit from the rule, or null when unbounded. */
function countLimit(rule: string): number | null {
  const match = /(?:^|;)COUNT=(\d+)(?:;|$)/.exec(rule);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * True when the recurring series renders at least one occurrence inside
 * [fromKey, toKey]. Enforces COUNT and UNTIL so exhausted series are not
 * returned for later windows. Dates are evaluated in UTC (the events table
 * stores instants; the MCP tool has no household timezone context).
 */
function seriesOccursInRange(event: RecurringRow, fromKey: string, toKey: string): boolean {
  const rule = event.recurrence_rule;
  if (!rule) return false;
  const series = {
    startAt: event.start_at,
    recurrenceRule: rule,
    recurrenceUntil: event.recurrence_until,
    excludedDates: event.excluded_dates,
    timeZone: "UTC",
  };
  const startKey = localDateKey(event.start_at, "UTC");
  if (!startKey) return false;
  const maxCount = countLimit(rule);
  let seen = 0;
  // Count occurrences from the series start so COUNT is honoured, but stop
  // once we pass the window or find a hit inside it.
  for (let day = startKey; day <= toKey; day = addDays(day, 1)) {
    if (maxCount !== null && seen >= maxCount) return false;
    if (!seriesCoversDate(series, day)) continue;
    seen += 1;
    if (day >= fromKey) return true;
  }
  return false;
}

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
