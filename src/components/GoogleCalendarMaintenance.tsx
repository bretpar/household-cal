import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  backfillGoogleSource,
  diagnoseGoogleInbound,
  getSyncSettings,
  inspectOccurrenceRows,
  reapplyGoogleInboundEvent,
  repairGoogleRecurrence,
  unlockCalendarMaintenance,
} from "@/lib/google.functions";

/** Unlock lasts for one session only, and no longer than this. */
const UNLOCK_DURATION_MS = 30 * 60 * 1000;

/**
 * Owner-only Google Calendar maintenance, hidden behind a support code.
 *
 * Exposes only the safe, non-destructive tools: read-only inbound diagnostic,
 * recurrence repair and bounded backfill. Every action is additionally
 * authorized server-side against the caller's owned household, and the calendar
 * list comes from that same household's connected Google sources. The unlock
 * lives in component state only, so it disappears on sign-out or reload and
 * auto-locks after 30 minutes.
 *
 * No QA/reset/destructive tooling belongs here.
 */
export function GoogleCalendarMaintenance() {
  const loadSettings = useServerFn(getSyncSettings);
  const settings = useQuery({ queryKey: ["google-sync-settings"], queryFn: () => loadSettings() });
  const unlockFn = useServerFn(unlockCalendarMaintenance);

  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => {
      setUnlocked(false);
      setOpen(false);
    }, UNLOCK_DURATION_MS);
    return () => clearTimeout(timer);
  }, [unlocked]);

  const unlock = useMutation({
    mutationFn: () => unlockFn({ data: { code } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error("That code isn’t right");
        return;
      }
      setCode("");
      setUnlocked(true);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not open maintenance"),
  });

  if (!settings.data?.is_owner) return null;

  const calendars = (settings.data.calendars ?? []).filter((c) => c.external_calendar_id);

  if (!unlocked) {
    return (
      <div className="rounded-3xl border border-border-soft bg-card p-4">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            Maintenance
          </button>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) unlock.mutate();
            }}
          >
            <Label htmlFor="maintenance-code">Maintenance code</Label>
            <p className="text-xs text-muted-foreground">
              Enter the support code to open Calendar Maintenance.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                id="maintenance-code"
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-11 max-w-56 rounded-xl"
              />
              <Button
                type="submit"
                variant="outline"
                className="h-11 rounded-full font-bold"
                disabled={!code.trim() || unlock.isPending}
              >
                {unlock.isPending ? "Checking…" : "Unlock"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-full font-bold"
                onClick={() => {
                  setOpen(false);
                  setCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">Calendar Maintenance</h3>
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-full font-bold"
          onClick={() => {
            setUnlocked(false);
            setOpen(false);
          }}
        >
          Lock
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Safe repair tools for this household&rsquo;s connected Google calendars.
      </p>
      <RecurrenceRepair />
      <GoogleInboundDiagnostic calendars={calendars} />
      <OccurrenceRowInspector />
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
        <h3 className="text-base font-bold">Repair recurrence rules</h3>
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

  // continuation point of the bounded instance pass, per calendar; kept internal
  const cursors = useRef<Record<string, string | null>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  /**
   * One click drives the whole resumable repair: keeps calling the bounded
   * server action while it reports remaining work, accumulating counts.
   */
  async function runBackfill() {
    if (!selected || running) return;
    setRunning(true);
    const totals = { examined: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, errored: 0 };
    let pass = 0;
    try {
      // hard safety bound on passes; each request stays bounded server-side
      for (let i = 0; i < 50; i += 1) {
        pass += 1;
        setProgress(
          `Repairing Google calendar… Pass ${pass} · ${totals.examined} checked · ${totals.created} restored`,
        );
        const summary = await backfillFn({
          data: { source_id: selected, cursor: cursors.current[selected] ?? null },
        });
        if (summary.skippedReason) {
          toast.info(`Backfill skipped (${summary.skippedReason})`);
          setProgress(null);
          setRunning(false);
          return;
        }
        totals.examined += summary.examined;
        totals.created += summary.created;
        totals.updated += summary.updated;
        totals.unchanged += summary.unchanged;
        totals.skipped += summary.skipped;
        totals.errored += summary.errored;
        cursors.current[selected] = summary.hasMore ? (summary.cursor ?? null) : null;
        setProgress(
          `Repairing Google calendar… Pass ${pass} · ${totals.examined} checked · ${totals.created} restored`,
        );
        if (!summary.hasMore) break;
      }
      toast.success(
        `Calendar repair complete · ${totals.created} missing events restored · ${totals.errored} errors`,
      );
      setProgress(null);
      // refresh calendar data afterwards; never block the summary on this
      void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
      void queryClient.invalidateQueries({ queryKey: ["google-sync-settings"] });
    } catch (error) {
      // cursor progress stays as-is so retry resumes where this run stopped
      toast.error(error instanceof Error ? error.message : "Backfill failed");
      setProgress("Repair paused — Try again");
    } finally {
      setRunning(false);
    }
  }



  const report = run.data && !("skipped" in run.data) ? run.data : null;
  const skipped = run.data && "skipped" in run.data ? run.data.skipped : null;

  return (
    <div className="space-y-3 rounded-3xl border border-border-soft bg-card p-4">
      <div>
        <h3 className="text-base font-bold">Inspect Google sync</h3>
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
          disabled={!selected || running}
          onClick={() => void runBackfill()}
        >
          {running ? "Repairing…" : "Repair missing Google events"}
        </Button>
        {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
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

/**
 * Read-only row inspector for a single Google instance. Shows every local card
 * that claims the instance (so duplicates are obvious), the parent series,
 * projection fields, assignments and link bookkeeping. Writes nothing.
 */
function OccurrenceRowInspector() {
  const inspect = useServerFn(inspectOccurrenceRows);
  const [googleEventId, setGoogleEventId] = useState("");
  const run = useMutation({
    mutationFn: () => inspect({ data: { google_event_id: googleEventId.trim() } }),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Inspection failed"),
  });
  const result = run.data ?? null;

  return (
    <div className="space-y-3 rounded-3xl border border-border-soft bg-card p-4">
      <div>
        <h3 className="text-base font-bold">Inspect one occurrence</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a Google event id (from “Inspect Google sync” above) to see the exact stored rows for
          that occurrence. Read-only.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (googleEventId.trim()) run.mutate();
        }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="inspect-google-id">Google event id</Label>
          <Input
            id="inspect-google-id"
            value={googleEventId}
            onChange={(e) => setGoogleEventId(e.target.value)}
            className="h-11 rounded-xl font-mono text-xs"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="h-11 rounded-full font-bold"
          disabled={!googleEventId.trim() || run.isPending}
        >
          {run.isPending ? "Inspecting…" : "Inspect rows"}
        </Button>
      </form>

      {result ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {result.matches.length} local row(s)
            {result.recurring_event_id ? ` · series ${result.recurring_event_id}` : ""}
            {result.skipped ? ` · ${result.skipped}` : ""}
          </p>
          {result.matches.map((m) => (
            <div
              key={m.local_event_id}
              className="space-y-1 rounded-2xl border border-border-soft bg-background p-3 text-xs"
            >
              <div className="text-sm font-bold">{m.title}</div>
              <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                <Row label="local event id" value={m.local_event_id} />
                <Row label="parent/series event id" value={m.parent_event_id} />
                <Row label="start" value={m.start_at} />
                <Row label="end" value={m.end_at} />
                <Row label="all day" value={m.all_day ? "yes" : "no"} />
                <Row label="external_event_id" value={m.external_event_id} />
                <Row label="external_recurring_event_id" value={m.external_recurring_event_id} />
                <Row label="recurrence_rule" value={m.recurrence_rule} />
                <Row label="recurrence_until" value={m.recurrence_until} />
                <Row label="excluded_dates" value={m.excluded_dates.join(", ") || null} />
                <Row label="last_change_source" value={m.last_change_source} />
                <Row
                  label="members"
                  value={
                    m.members
                      .map(
                        (p) =>
                          `${p.name ?? p.family_member_id}${p.weekdays ? ` [${p.weekdays.join(",")}]` : ""}`,
                      )
                      .join(" · ") || null
                  }
                />
              </dl>
              {m.links.map((l) => (
                <dl key={l.id} className="mt-1 grid gap-x-3 gap-y-0.5 border-t border-border-soft pt-1 sm:grid-cols-2">
                  <Row label="link id" value={l.id} />
                  <Row label="link branch" value={`"${l.branch_key}"`} />
                  <Row label="link google_event_id" value={l.google_event_id} />
                  <Row label="link google_recurring_event_id" value={l.google_recurring_event_id} />
                  <Row label="link last_source" value={l.last_source} />
                  <Row label="link sync_error" value={l.sync_error} />
                </dl>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
