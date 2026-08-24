import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getConnection } from "@/lib/google/sync.server";
import { listCalendars } from "@/lib/google/api.server";

const family = "43ba35c9-6886-4e16-bb9d-5f795b0046f9";
const conn = await getConnection(supabaseAdmin, family);
if (!conn) throw new Error("no connection");
console.log("account:", conn.accountEmail);
for (const c of await listCalendars(conn.connectionKey)) {
  console.log(JSON.stringify({ id: c.id, summary: c.summary, primary: c.primary, role: c.accessRole }));
}
