import { createFileRoute } from "@tanstack/react-router";
import { CaregiverOnboarding } from "@/components/CaregiverOnboarding";

export const Route = createFileRoute("/_authenticated/caregiver/onboarding")({
  head: () => ({ meta: [
    { title: "Caregiver setup — Our Family Calendar" },
    { name: "description", content: "Add your private family contacts and optionally connect your caregiver work calendar." },
    { property: "og:title", content: "Caregiver setup — Our Family Calendar" },
    { property: "og:description", content: "Set up your independent caregiver schedule and Google Calendar." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: CaregiverOnboarding,
});