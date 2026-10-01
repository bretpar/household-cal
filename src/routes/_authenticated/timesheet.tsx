import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CaregiverOnly } from "@/components/CaregiverGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  STATUS_LABEL,
  formatHours,
  hoursBetween,
} from "@/lib/timesheet-periods";
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
    typeof search.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.period) ? { period: search.period } : {},
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

function TimesheetRoute() {
  return (
    <CaregiverOnly fallback="/today">
      <AppShell>
        <TimesheetPage />
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
    <div className="mx-auto max-w-lg space-y-4">
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
  const editable = sheet.status === "draft" || sheet.status === "needs_correction";
  const total = sheet.entries.reduce((n, e) => n + hoursBetween(e.actual_start, e.actual_end), 0);
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-timesheet"] });
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
      <div className="flex items-center justify-between rounded-2xl border border-border-soft bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="font-bold">{STATUS_LABEL[sheet.status]}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total actual</p>
          <p className="font-bold">{formatHours(total)}</p>
        </div>
      </div>
      {sheet.status === "needs_correction" && sheet.parent_note ? (
        <p className="rounded-2xl border border-border bg-surface-muted p-3 text-sm">
          <span className="font-semibold">Note from parent: </span>
          {sheet.parent_note}
        </p>
      ) : null}

      <ul className="space-y-3">
        {sheet.entries.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No shifts in this pay period.
          </li>
        ) : null}
        {sheet.entries.map((e) => (
          <EntryCard key={e.id} entry={e} sheet={sheet} editable={editable} onSaved={refresh} />
        ))}
      </ul>

      {editable ? (
        <div className="space-y-3">
          {adding ? (
            <EntryEditor sheet={sheet} onDone={() => { setAdding(false); void refresh(); }} onCancel={() => setAdding(false)} />
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
  onSaved,
}: {
  entry: TimesheetEntry;
  sheet: TimesheetView;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useServerFn(deleteManualEntry);
  const tz = sheet.time_zone;
  if (editing) {
    return (
      <li>
        <EntryEditor sheet={sheet} entry={entry} onDone={() => { setEditing(false); onSaved(); }} onCancel={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="space-y-1.5 rounded-2xl border border-border-soft bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">{fmtDate(entry.work_date, { weekday: "short", month: "short", day: "numeric" })}</p>
        <p className="font-semibold">{formatHours(hoursBetween(entry.actual_start, entry.actual_end))}</p>
      </div>
      {entry.is_manual ? (
        <p className="text-xs font-semibold text-primary">Manually added</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Scheduled {fmtTime(entry.scheduled_start, tz)} – {fmtTime(entry.scheduled_end, tz)}
        </p>
      )}
      <p>
        Actual {fmtTime(entry.actual_start, tz)} – {fmtTime(entry.actual_end, tz)}
      </p>
      {entry.note ? <p className="text-xs text-muted-foreground">{entry.note}</p> : null}
      {editable ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit actual time</Button>
          {entry.is_manual ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove entry"
              onClick={async () => {
                try {
                  await remove({ data: { timesheet_id: sheet.id, entry_id: entry.id } });
                  onSaved();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not remove");
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function EntryEditor({
  sheet,
  entry,
  onDone,
  onCancel,
}: {
  sheet: TimesheetView;
  entry?: TimesheetEntry;
  onDone: () => void;
  onCancel: () => void;
}) {
  const save = useServerFn(saveTimesheetEntry);
  const [date, setDate] = useState(entry?.work_date ?? sheet.period_start);
  const [start, setStart] = useState(entry?.actual_start_local ?? "09:00");
  const [end, setEnd] = useState(entry?.actual_end_local ?? "17:00");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl border border-primary/40 bg-card p-4">
      {!entry ? (
        <div className="space-y-1">
          <Label htmlFor="ts-date">Date</Label>
          <Input id="ts-date" type="date" min={sheet.period_start} max={sheet.period_end} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="ts-start">Actual start</Label>
          <Input id="ts-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ts-end">Actual end</Label>
          <Input id="ts-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ts-note">Note (optional)</Label>
        <Input id="ts-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">An end time before the start counts as overnight.</p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busy || !start || !end || !date}
          onClick={async () => {
            setBusy(true);
            try {
              await save({ data: { timesheet_id: sheet.id, entry_id: entry?.id ?? null, work_date: date, start, end, note: note || null } });
              onDone();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
