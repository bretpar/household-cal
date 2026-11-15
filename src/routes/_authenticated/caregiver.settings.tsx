import { createFileRoute } from "@tanstack/react-router";
import { IndependentCaregiverWorkspace } from "@/components/IndependentCaregiverWorkspace";
export const Route = createFileRoute("/_authenticated/caregiver/settings")({
  head: () => ({ meta: [
    { title: "Caregiver Settings — Our Family Calendar" }, { name: "description", content: "Manage your private family contacts, account and personal Google Calendar connection." },
    { property: "og:title", content: "Caregiver Settings — Our Family Calendar" }, { property: "og:description", content: "Your caregiver contacts and work calendar settings." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <IndependentCaregiverWorkspace tab="settings" />,
});