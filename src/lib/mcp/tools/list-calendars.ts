import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_calendars",
  title: "List calendars",
  description: "List the active calendars in a household that the signed-in user can see.",
  inputSchema: { household_id: z.string().uuid().describe("Household id from list_households.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ household_id }, ctx) => {
    const { data, error } = await supabaseForUser(ctx)
      .from("calendar_sources")
      .select("id, name, provider, display_mode, color")
      .eq("family_id", household_id)
      .eq("active", true)
      .neq("calendar_kind", "legacy_internal")
      .order("sort_order");
    if (error) throw new ToolError(error.message);
    const calendars = (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      display_mode: c.display_mode,
      color: c.color,
    }));
    return { content: [{ type: "text", text: JSON.stringify(calendars) }], structuredContent: { calendars } };
  },
});
