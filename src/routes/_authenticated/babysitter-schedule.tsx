import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ScheduleBuilder } from "@/components/ScheduleBuilder";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/babysitter-schedule")({
  head: () => ({ meta: [
    { title: "Build Babysitter Schedule — Our Family Calendar" },
    { name: "description", content: "Private monthly Babysitter schedule drafts and reusable weekday templates for household Owners and Editors." },
    { property: "og:title", content: "Build Babysitter Schedule — Our Family Calendar" },
    { property: "og:description", content: "Plan caregiver shifts in a private monthly workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: () => <AppShell><div className="hidden space-y-5 lg:block"><header className="flex items-center gap-3"><Button asChild variant="ghost" size="icon"><Link to="/activities" aria-label="Back to Activities"><ChevronLeft /></Link></Button><h1 className="text-2xl font-bold">Build Babysitter Schedule</h1></header><ScheduleBuilder /></div></AppShell>,
});