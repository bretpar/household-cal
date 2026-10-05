import { auth, defineMcp } from "@lovable.dev/mcp-js";

import listCalendars from "./tools/list-calendars";
import listEvents from "./tools/list-events";
import listHouseholds from "./tools/list-households";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "household-calendar",
  title: "Household Calendar",
  version: "0.1.0",
  instructions:
    "Read-only access to the signed-in user's household calendars. Call list_households first, then list_calendars or list_events with a household id.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listHouseholds, listCalendars, listEvents],
});
