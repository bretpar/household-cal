import { createFileRoute } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace } from "@/components/IndependentCaregiverWorkspace";
export const Route = createFileRoute("/_authenticated/caregiver/timesheets")({
  head: () => ({ meta: [
    { title: "Caregiver Scheduled Hours — Our Family Calendar" }, { name: "description", content: "Monthly scheduled work hours by family for your caregiver account." },
    { property: "og:title", content: "Caregiver Scheduled Hours — Our Family Calendar" }, { property: "og:description", content: "Review scheduled hours without altering actual time records." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <IndependentCaregiverWorkspace tab="timesheets" />,
});