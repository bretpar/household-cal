import { createFileRoute } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace } from "@/components/IndependentCaregiverWorkspace";
export const Route = createFileRoute("/_authenticated/caregiver/today")({
  head: () => ({ meta: [
    { title: "Caregiver Today — Our Family Calendar" }, { name: "description", content: "Your upcoming personal work shifts and scheduled hours." },
    { property: "og:title", content: "Caregiver Today — Our Family Calendar" }, { property: "og:description", content: "Your private caregiver work schedule." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <IndependentCaregiverWorkspace tab="today" />,
});