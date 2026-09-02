import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  backfillGoogleSource,
  diagnoseGoogleInbound,
  getSyncSettings,
  reapplyGoogleInboundEvent,
  repairGoogleRecurrence,
} from "@/lib/google.functions";

/**
 * Owner-only Google Calendar maintenance.
 *
 * Exposes only the safe, non-destructive tools: read-only inbound diagnostic,
 * recurrence repair and bounded backfill. Every action is additionally
 * authorized server-side against the caller's owned household, and the calendar
 * list comes from that same household's connected Google sources.
 *
 * No QA/reset/destructive tooling belongs here.
 */
export function GoogleCalendarMaintenance() {
  const loadSettings = useServerFn(getSyncSettings);
  const settings = useQuery({ queryKey: ["google-sync-settings"], queryFn: () => loadSettings() });

  if (!settings.data?.is_owner) return null;

  const calendars = (settings.data.calendars ?? []).filter((c) => c.external_calendar_id);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Safe repair tools for this household&rsquo;s connected Google calendars. Available to
        household owners only.
      </p>
      <RecurrenceRepair />
      <GoogleInboundDiagnostic calendars={calendars} />
    </div>
  );
}

/** Re-reads authoritative repeat rules from Google. Idempotent. */
function RecurrenceRepair() {
  const queryClient = useQueryClient();
  const repair = useServerFn(repairGoogleRecurrence);
  const repairMutation = useMutation({
    mutationFn: () => repair({ data: {} }),
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries();
      if (summary.skippedReason) {
        toast.info(`Recurrence repair skipped (${summary.skippedReason})`);
        return;
      }
      toast.success(
        `Recurrence repair · examined ${summary.examined ?? 0} · repaired ${summary.repaired ?? 0} · unchanged ${summary.unchanged ?? 0} · skipped ${summary.skipped ?? 0} · errored ${summary.errored ?? 0}`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Recurrence repair failed"),
  });

  return (
    <div className="space-y-3 rounded-3xl border border-border-soft bg-card p-4">
      <div>
        <h3 className="text-base font-bold">Repair Google recurrence rules</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Re-reads repeat rules from Google for linked recurring events and restores weekdays lost by
          older imports. Safe to run more than once.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 rounded-full font-bold"
        disabled={repairMutation.isPending}
        onClick={() => repairMutation.mutate()}
      >
        {repairMutation.isPending ? "Repairing…" : "Repair recurrence rules"}
      </Button>
    </div>
  );
}

interface CalendarOption {
  id: string;
  name: string;
  external_calendar_id: string | null;
}

/**
 * Read-only inbound-sync inspector for one Google calendar and date, plus a
 * targeted re-apply of a single Google event and a bounded full-window
 * backfill. Nothing here changes normal sync behaviour.
 */
function GoogleInboundDiagnostic({ calendars }: { calendars: CalendarOption[] }) {
  const queryClient = useQueryClient();
  const diagnose = useServerFn(diagnoseGoogleInbound);
  const reapply = useServerFn(reapplyGoogleInboundEvent);
  const backfillFn = useServerFn(backfillGoogleSource);

  const [sourceId, setSourceId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const selected = sourceId || calendars[0]?.id || "";

  const run = useMutation({
    mutationFn: () => diagnose({ data: { source_id: selected, date } }),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Diagnostic failed"),
  });

  const repairOne = useMutation({
    mutationFn: (googleEventId: string) =>
      reapply({ data: { source_id: selected, google_event_id: googleEventId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      if (result.skipped) toast.info(`Re-apply skipped (${result.skipped})`);
      else toast.success("Google event re-applied through normal sync");
      run.mutate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Re-apply failed"),
  });

  const backfill = useMutation({
    mutationFn: () => backfillFn({ data: { source_id: selected } }),
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries();
      if (summary.skippedReason) {
        toast.info(`Backfill skipped (${summary.skippedReason})`);
        return;
      }
      toast.success(
        `Backfill · examined ${summary.examined} · created ${summary.created} · updated ${summary.updated} · unchanged ${summary.unchanged} · skipped ${summary.skipped} · errored ${summary.errored}`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Backfill failed"),
  });

  const report = run.data && !("skipped" in run.data) ? run.data : null;
  const skipped = run.data && "skipped" in run.data ? run.data.skipped : null;

  return (
    <div className="space-y-3 rounded-3xl border border-border-soft bg-card p-4">
      <div>
        <h3 className="text-base font-bold">Google inbound sync diagnostic</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Lists exactly what Google returns for one calendar and date, and what inbound sync would do
          with each item. Read-only.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="diag-calendar">Google calendar</Label>
          <select
            id="diag-calendar"
            value={selected}
            onChange={(e) => setSourceId(e.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            {calendars.length === 0 ? <option value="">No connected calendars</option> : null}
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diag-date">Date</Label>
          <Input
            id="diag-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 rounded-xl"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full font-bold"
          disabled={!selected || run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? "Inspecting…" : "Inspect day"}
        </Button>
      </div>

      <div className="space-y-2 rounded-2xl border border-border-soft bg-background p-3">
        <p className="text-sm text-muted-foreground">
          Backfill re-reads the selected calendar over a bounded window (30 days back through 12
          months ahead) without using the incremental sync token, so previously missed Google events
          get imported. Idempotent; never deletes events.
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full font-bold"
          disabled={!selected || backfill.isPending}
          onClick={() => backfill.mutate()}
        >
          {backfill.isPending ? "Backfilling…" : "Backfill Google events"}
        </Button>
      </div>

      {skipped ? <p className="text-sm text-muted-foreground">Skipped: {skipped}</p> : null}

      {report ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {report.calendar.name} · {report.date} · {report.time_zone} · {report.items.length}{" "}
            Google item(s)
          </p>
          {report.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Google returned nothing for this day.</p>
          ) : null}
          {report.items.map((item) => (
            <div
              key={`${item.google_event_id}-${item.original_start_time ?? ""}`}
              className="space-y-1 rounded-2xl border border-border-soft bg-background p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold">{item.title ?? "(untitled)"}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 font-bold">{item.decision}</span>
              </div>
              <p className="text-muted-foreground">{item.decision_detail}</p>
              <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                <Row label="Google id" value={item.google_event_id} />
                <Row label="recurringEventId" value={item.recurring_event_id} />
                <Row label="originalStartTime" value={item.original_start_time} />
                <Row label="status" value={item.status} />
                <Row label="start" value={item.start} />
                <Row label="end" value={item.end} />
                <Row label="all day" value={item.all_day ? "yes" : "no"} />
                <Row label="updated" value={item.updated} />
                <Row label="recurrence" value={item.recurrence?.join(" | ") ?? null} />
                <Row label="local event" value={item.local_event_id} />
                <Row label="local title" value={item.local_event_title} />
                <Row label="link id" value={item.link?.id ?? null} />
                <Row label="link branch" value={item.link ? `"${item.link.branch_key}"` : null} />
                <Row label="link last_source" value={item.link?.last_source ?? null} />
                <Row label="link sync_error" value={item.link?.sync_error ?? null} />
              </dl>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-1 rounded-full font-bold"
                disabled={repairOne.isPending}
                onClick={() => repairOne.mutate(item.google_event_id)}
              >
                Re-apply this Google event
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-all font-mono">{value}</dd>
    </div>
  );
}
