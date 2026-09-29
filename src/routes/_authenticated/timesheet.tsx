import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CaregiverOnly } from "@/components/CaregiverGate";

export const Route = createFileRoute("/_authenticated/timesheet")({
  head: () => ({
    meta: [
      { title: "Timesheet — Family Calendar" },
      { name: "description", content: "Review and submit your babysitting hours — coming soon." },
      { property: "og:title", content: "Timesheet — Family Calendar" },
      { property: "og:description", content: "Caregiver timesheets are coming soon." },
    ],
  }),
  component: TimesheetRoute,
});

function TimesheetRoute() {
  return (
    <CaregiverOnly fallback="/today">
      <AppShell>
        <div className="mx-auto max-w-lg space-y-4 rounded-3xl border border-border-soft bg-card p-6 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">Timesheets</h1>
          <p className="text-sm text-muted-foreground">
            Coming soon! You'll be able to review your scheduled babysitting hours, make adjustments
            and submit your timesheet directly to your family.
          </p>
        </div>
      </AppShell>
    </CaregiverOnly>
  );
}
