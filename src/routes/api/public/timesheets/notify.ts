import { createFileRoute } from "@tanstack/react-router";

import { runScheduledJob } from "@/lib/scheduler-auth.server";

/** Hourly scheduler: pay-period-ready emails and one-time reminders. Idempotent. */
export const Route = createFileRoute("/api/public/timesheets/notify")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        runScheduledJob("timesheet-notifications", request, async () => {
          const { runTimesheetNotifications } = await import("@/lib/timesheet-notify.server");
          return runTimesheetNotifications(new Date());
        }),
    },
  },
});
