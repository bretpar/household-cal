import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CaregiverOnly } from "@/components/CaregiverGate";
import { TimeField } from "@/components/TimeField";
import { useCalendar } from "@/lib/calendar-store";
import { hasFeature } from "@/lib/features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  STATUS_LABEL,
  formatHoursLabel,
  hoursBetween,
  localHours,
} from "@/lib/timesheet-periods";
import { MY_TIMESHEET_ACTIONS_KEY } from "@/components/TimesheetSettings";
import {
  deleteManualEntry,
  getMyTimesheet,
  saveTimesheetEntry,
  submitTimesheet,
  type TimesheetEntry,
  type TimesheetView,
} from "@/lib/timesheets.functions";

export const Route = createFileRoute("/_authenticated/timesheet")({
  validateSearch: (search: Record<string, unknown>): { period?: string } =>
    typeof search["period"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["period"]) ? { period: search["period"] } : {},
  head: () => ({
    meta: [
      { title: "Timesheet — Family Calendar" },
      { name: "description", content: "Review your babysitting hours and submit your timesheet." },
      { property: "og:title", content: "Timesheet — Family Calendar" },
      { property: "og:description", content: "Caregiver timesheets for each pay period." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetRoute,
});

function TimesheetGate() {
  const { family } = useCalendar();
  if (!hasFeature("timesheets", { familyId: family?.id })) {
    return <p className="text-sm text-muted-foreground">Timesheets aren't available for this household.</p>;
  }
  return <TimesheetPage />;
}

function TimesheetRoute() {
  return (
    <CaregiverOnly fallback="/today">
      <AppShell>
        <TimesheetGate />
      </AppShell>
    </CaregiverOnly>
  );
}

export const fmtDate = (key: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
export const fmtTime = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";

function TimesheetPage() {
  const { period } = Route.useSearch();
  const [linkPeriod, setLinkPeriod] = useState(period);
  const [offset, setOffset] = useState(0);
  const fetchSheet = useServerFn(getMyTimesheet);
  const query = useQuery({
    queryKey: ["my-timesheet", linkPeriod ? `p:${linkPeriod}` : offset],
    queryFn: () => fetchSheet({ data: { offset, period_start: linkPeriod } }),
  });
  const sheet = query.data;
  // Leaving an emailed deep link: continue navigating from the resolved period.
  const move = (delta: number) => {
    const base = linkPeriod && sheet ? sheet.offset : offset;
    setLinkPeriod(undefined);
    setOffset(Math.min(0, base + delta));
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-8 md:pb-0">
      <header className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" aria-label="Previous pay period" onClick={() => move(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <h1 className="text-xl font-bold">Timesheet</h1>
          {sheet ? (
            <p className="text-sm text-muted-foreground">
              {fmtDate(sheet.period_start)} – {fmtDate(sheet.period_end, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next pay period"
          disabled={(linkPeriod && sheet ? sheet.offset : offset) >= 0}
          onClick={() => move(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </header>
      {query.isLoading ? <p className="text-center text-sm text-muted-foreground">Loading…</p> : null}
      {query.error ? (
        <p className="text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Could not load timesheet"}
        </p>
      ) : null}
      {sheet ? <SheetBody sheet={sheet} /> : null}
    </div>
  );
}

function SheetBody({ sheet }: { sheet: TimesheetView }) {
  const qc = useQueryClient();
  const submit = useServerFn(submitTimesheet);
  const [adding, setAdding] = useState(false);
  // Display-only hours while an editor is open or a save is refreshing; server stays authoritative.
  const [preview, setPreview] = useState<Record<string, number>>({});
  const setPreviewFor = (key: string, hours: number | null) =>
    setPreview((p) => {
      const next = { ...p };
      if (hours === null) delete next[key];
      else next[key] = hours;
      return next;
    });
  const editable = (sheet.status === "draft" || sheet.status === "needs_correction") && !sheet.before_start;
  const hoursFor = (e: TimesheetEntry) => preview[e.id] ?? hoursBetween(e.actual_start, e.actual_end);
  const total = sheet.entries.reduce((n, e) => n + hoursFor(e), 0) + (preview["new"] ?? 0);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["my-timesheet"] });
    void qc.invalidateQueries({ queryKey: MY_TIMESHEET_ACTIONS_KEY });
  };
  const submitMutation = useMutation({
    mutationFn: () => submit({ data: { timesheet_id: sheet.id } }),
    onSuccess: () => {
      toast.success("Timesheet submitted");
      void refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not submit"),
  });

  return (
    <>
      <div className="flex items-center justify-between rounded-2xl border border-border-soft bg-card px-4 py-3.5">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="text-base font-bold">{STATUS_LABEL[sheet.status]}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-base font-bold">{formatHoursLabel(total)}</p>
        </div>
      </div>
      {sheet.before_start ? (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          This pay period is before your Timesheet start date.
        </p>
      ) : null}
      {sheet.status === "closed" ? (
        <p className="rounded-2xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          This timesheet was closed by the household. It's kept for your records.
        </p>
      ) : null}
      {sheet.status === "needs_correction" ? (
        <div role="alert" className="rounded-2xl border-2 border-destructive bg-destructive/10 p-4 text-sm">
          <p className="font-bold text-destructive">Correction requested</p>
          {sheet.parent_note ? <p className="mt-1 whitespace-pre-wrap">{sheet.parent_note}</p> : null}
        </div>
      ) : null}

      <ul className="space-y-3">
        {sheet.entries.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No shifts in this pay period.
          </li>
        ) : null}
        {sheet.entries.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            sheet={sheet}
            editable={editable}
            hours={hoursFor(e)}
            onPreview={(h) => setPreviewFor(e.id, h)}
            onSaved={async () => { await refresh(); setPreviewFor(e.id, null); }}
          />
        ))}
      </ul>

      {editable ? (
        <div className="space-y-3">
          {adding ? (
            <EntryEditor
              sheet={sheet}
              onPreview={(h) => setPreviewFor("new", h)}
              onDone={async () => { setAdding(false); await refresh(); setPreviewFor("new", null); }}
              onCancel={() => { setAdding(false); setPreviewFor("new", null); }}
            />
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add missing shift
            </Button>
          )}
          <Button className="w-full" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
            {sheet.status === "needs_correction" ? "Resubmit timesheet" : "Submit timesheet"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function EntryCard({
  entry,
  sheet,
  editable,
  hours,
  onPreview,
  onSaved,
}: {
  entry: TimesheetEntry;
  sheet: TimesheetView;
  editable: boolean;
  hours: number;
  onPreview: (hours: number | null) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useServerFn(deleteManualEntry);
  const tz = sheet.time_zone;
  if (editing) {
    return (
      <li>
        <EntryEditor
          sheet={sheet}
          entry={entry}
          hours={hours}
          onPreview={onPreview}
          onDone={() => { setEditing(false); void onSaved(); }}
          onCancel={() => { setEditing(false); onPreview(null); }}
        />
      </li>
    );
  }
  return (
    <li className="rounded-2xl border border-border-soft bg-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-lg font-bold leading-tight">
          {fmtDate(entry.work_date, { weekday: "short", month: "short", day: "numeric" })}
        </p>
        <p className="shrink-0 text-base font-bold">{formatHoursLabel(hours)}</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="min-w-0 text-base text-muted-foreground">
          {fmtTime(entry.actual_start, tz)}–{fmtTime(entry.actual_end, tz)}
        </p>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1">
            {entry.is_manual ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                aria-label="Remove entry"
                onClick={async () => {
                  try {
                    await remove({ data: { timesheet_id: sheet.id, entry_id: entry.id } });
                    void onSaved();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not remove");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="h-10 rounded-xl px-5" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        ) : null}
      </div>
      {entry.note ? <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p> : null}
    </li>
  );
}

function EntryEditor({
  sheet,
  entry,
  hours,
  onPreview,
  onDone,
  onCancel,
}: {
  sheet: TimesheetView;
  entry?: TimesheetEntry;
  hours?: number;
  onPreview: (hours: number | null) => void;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const save = useServerFn(saveTimesheetEntry);
  const [date, setDate] = useState(entry?.work_date ?? sheet.period_start);
  const [start, setStart] = useState(entry?.actual_start_local ?? "09:00");
  const [end, setEnd] = useState(entry?.actual_end_local ?? "17:00");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const live = localHours(start, end);
  const dirty = !entry || start !== entry.actual_start_local || end !== entry.actual_end_local || note !== (entry.note ?? "");
  useEffect(() => {
    onPreview(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  return (
    <div className="space-y-3 rounded-2xl border border-primary/40 bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="min-w-0 truncate font-bold">
          {entry ? fmtDate(entry.work_date, { weekday: "short", month: "short", day: "numeric" }) : "Add missing shift"}
        </p>
        <p className="shrink-0 font-semibold">{formatHoursLabel(hours ?? live)}</p>
      </div>
      {entry && !entry.is_manual ? (
        <p className="text-xs text-muted-foreground">
          Scheduled · {fmtTime(entry.scheduled_start, sheet.time_zone)}–{fmtTime(entry.scheduled_end, sheet.time_zone)}
        </p>
      ) : null}
      {!entry ? (
        <div className="space-y-1">
          <Label htmlFor="ts-date" className="text-xs">Date</Label>
          <Input id="ts-date" type="date" className="w-full min-w-0" min={sheet.period_start} max={sheet.period_end} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs">Actual</Label>
        <div className="time-row grid min-w-0 grid-cols-1 items-center gap-2 min-[340px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <TimeField id={`ts-start-${entry?.id ?? "new"}`} value={start} onChange={setStart} />
          <span className="hidden text-muted-foreground min-[340px]:block" aria-hidden>→</span>
          <TimeField id={`ts-end-${entry?.id ?? "new"}`} value={end} onChange={setEnd} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`ts-note-${entry?.id ?? "new"}`} className="text-xs">Add note (optional)</Label>
        <Input id={`ts-note-${entry?.id ?? "new"}`} className="w-full" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">An end time before the start counts as overnight.</p>
      <div className={entry && !dirty ? "" : "grid grid-cols-2 gap-2"}>
        <Button variant="outline" className={entry && !dirty ? "w-full" : undefined} onClick={onCancel} disabled={busy}>Cancel</Button>
        {!entry || dirty ? <Button
          disabled={busy || !dirty || !start || !end || !date}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ data: { timesheet_id: sheet.id, entry_id: entry?.id ?? null, work_date: date, start, end, note: note || null } });
              await onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          {entry ? "Save changes" : "Add shift"}
        </Button> : null}
      </div>
    </div>
  );
}
