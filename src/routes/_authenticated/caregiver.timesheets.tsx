import { createFileRoute } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace } from "@/components/IndependentCaregiverWorkspace";
export const Route = createFileRoute("/_authenticated/caregiver/timesheets")({
  head: () => ({ meta: [
    { title: "Caregiver Timesheets — Our Family Calendar" }, { name: "description", content: "Private per-family timesheets with configurable periods, scheduled hours, saved actual adjustments and PDF sharing." },
    { property: "og:title", content: "Caregiver Timesheets — Our Family Calendar" }, { property: "og:description", content: "Review scheduled and adjusted hours for each family and share a timesheet PDF." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <IndependentCaregiverWorkspace tab="timesheets" />,
});