import { createFileRoute } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace } from "@/components/IndependentCaregiverWorkspace";
export const Route = createFileRoute("/_authenticated/caregiver/calendar")({
  head: () => ({ meta: [
    { title: "Caregiver Work Calendar — Our Family Calendar" }, { name: "description", content: "Schedule and manage your private family work shifts." },
    { property: "og:title", content: "Caregiver Work Calendar — Our Family Calendar" }, { property: "og:description", content: "All your client shifts on one personal calendar." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <IndependentCaregiverWorkspace tab="calendar" />,
});