import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace, type CaregiverTab } from "@/components/IndependentCaregiverWorkspace";

// One persistent workspace + shell for all four caregiver tabs; children only own head().
function CaregiverAppLayout() {
  const pathname = useLocation({ select: l => l.pathname });
  const segment = pathname.replace(/\/+$/, "").split("/").pop();
  const tab: CaregiverTab = segment === "calendar" || segment === "timesheets" || segment === "settings" ? segment : "today";
  return <><IndependentCaregiverWorkspace tab={tab} /><Outlet /></>;
}
export const Route = createFileRoute("/_authenticated/_caregiverApp")({ component: CaregiverAppLayout });
