import { defineTool, ToolError } from "@lovable.dev/mcp-js";

import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_households",
  title: "List households",
  description: "List the households the signed-in user belongs to, with their time zone.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { data, error } = await supabaseForUser(ctx).from("families").select("id, name, timezone").order("name");
    if (error) throw new ToolError(error.message);
    const households = (data ?? []).map((f) => ({ id: f.id, name: f.name, timezone: f.timezone }));
    return { content: [{ type: "text", text: JSON.stringify(households) }], structuredContent: { households } };
  },
});
