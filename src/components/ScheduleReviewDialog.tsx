import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, ChevronUp, LockKeyhole, RefreshCw, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { shiftConfirmed, type Assignment, type ExistingShift, type ScheduleDraft } from "@/lib/schedule-builder";
import type { PublishPlan, PublishPlanOp } from "@/lib/schedule-publish";
import { groupPlanOps, originalVerified, plannedHours, reviewReadiness } from "@/lib/schedule-review";
import { executeSchedulePublish, getSchedulePublishGate, planSchedulePublish } from "@/lib/schedule-publish.functions";
import type { PublishExecutionResult } from "@/lib/schedule-publish.server";
import type { FamilyMember } from "@/lib/family-data";

type Preview = {
  revision: number;
  plan: PublishPlan;
  eventVersions: Record<string, string>;
  previewId: string;
};

const labelDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const shortDate = (date: string) => labelDate(date, { weekday: "short", month: "short", day: "numeric" });
const sameAssignment = (a: Assignment, b: Assignment) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Desktop Review & Publish dialog for the Babysitter Schedule Builder.
 * Read-only: it classifies the saved draft through the owner-authorized
 * server preview and collects explicit confirmation per category (changes,
 * additions, removals). Publishing itself stays a separate explicit action —
 * no calendar, Google, or Timesheet writes happen here.
 */
export function ScheduleReviewDialog({ familyId, month, draft, revision, dirty, existing, members, timeZone, onClose, onUndoRemoval, onPublished }: {
  familyId: string;
  month: string;
  draft: ScheduleDraft;
  revision: number;
  dirty: boolean;
  existing: ExistingShift[];
  members: FamilyMember[];
  timeZone: string;
  onClose: () => void;
  onUndoRemoval: (id: string) => Promise<void>;
  onPublished: () => Promise<void>;
}) {
  const loadPreview = useServerFn(planSchedulePublish);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const loadRef = useRef(loadPreview);
  loadRef.current = loadPreview;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [showKept, setShowKept] = useState(false);
  const gateFn = useServerFn(getSchedulePublishGate);
  const publishFn = useServerFn(executeSchedulePublish);
  const [gateOpen, setGateOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishExecutionResult | null>(null);
  useEffect(() => {
    gateFn({ data: { familyId } }).then((g) => setGateOpen(g.enabled)).catch(() => setGateOpen(false));
  }, [familyId, gateFn]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setConfirmed(new Set());
    setResult(null);
    try {
      const next = await loadRef.current({ data: { familyId, month } });
      setPreview(next);
      setConfirmed(new Set(next.plan.ops.filter(op => {
        const shift = draftRef.current.shifts.find(s => s.id === op.shiftId);
        return op.kind === "update" && originalVerified(op) && !!shift && shiftConfirmed(shift, op.original?.eventVersion);
      }).map(op => op.shiftId)));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "The review preview could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [familyId, month]);
  useEffect(() => { void refresh(); }, [refresh]);

  // The preview classifies the saved draft. Unsaved local edits — or another
  // Owner saving a newer revision — make it stale until saved and refreshed.
  const stale = dirty || (preview !== null && preview.revision !== revision);
  const groups = preview ? groupPlanOps(preview.plan) : null;
  const readiness = preview ? reviewReadiness(preview.plan, confirmed, stale) : null;

  const shiftById = useMemo(() => new Map([...draft.shifts, ...(draft.removals ?? [])].map((s) => [s.id, s])), [draft]);
  const assignmentLabel = (a: Assignment) =>
    a.kind === "caregiver"
      ? members.find((m) => m.id === a.family_member_id)?.name ?? "Former caregiver"
      : a.kind === "other"
        ? a.name
        : "Unassigned";
  const hours = preview ? plannedHours(preview.plan, draft) : 0;

  const publish = async () => {
    if (!preview || !readiness?.ready || stale) return;
    setPublishing(true);
    setError("");
    try {
      setResult(await publishFn({ data: {
        familyId, month, revision: preview.revision, previewId: preview.previewId,
        reviewedShiftIds: [...confirmed], reviewedEventVersions: preview.eventVersions,
      } }));
      await onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing failed. Nothing new was confirmed.");
    } finally {
      setPublishing(false);
    }
  };
  const googleLabel: Record<PublishExecutionResult["google"]["status"], string> = {
    not_applicable: "Google: not connected for these shifts",
    pending: "Google sync pending — it will finish in the background",
    synced: "Google Calendar synced",
    needs_attention: "Google sync needs attention",
  };

  // Group approval translates into the same per-operation confirmation ids the
  // server already requires; it never bypasses conflicts, stale previews or
  // unverified originals.
  const confirmGroup = (ops: PublishPlanOp[], checked: boolean) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      for (const op of ops) {
        if (checked) next.add(op.shiftId);
        else next.delete(op.shiftId);
      }
      return next;
    });
  const groupState = (ops: PublishPlanOp[]): boolean | "indeterminate" => {
    const done = ops.filter((op) => confirmed.has(op.shiftId)).length;
    if (ops.length === 0 || done === 0) return false;
    return done === ops.length ? true : "indeterminate";
  };
  const controlsLocked = loading || publishing || !!result || stale;

  const groupHeader = (title: string, ops: PublishPlanOp[], label: string, tone: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={cn("text-sm font-semibold", tone)}>{title} ({ops.length})</h3>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
        <Checkbox
          checked={groupState(ops)}
          disabled={controlsLocked}
          aria-label={label}
          onCheckedChange={(v) => confirmGroup(ops, v === true)}
        />
        {label}
      </label>
    </div>
  );

  const updateRow = (op: PublishPlanOp) => {
    const after = shiftById.get(op.shiftId);
    // Server-reviewed, version-bound original only; never builder-cached data.
    const before = originalVerified(op) ? op.original! : undefined;
    if (!after || !before) {
      return <li key={op.shiftId} className="px-3 py-1.5 text-xs text-muted-foreground">Shift detail could not be verified — refresh the preview.</li>;
    }
    const timeChanged = before.start !== after.start || before.end !== after.end;
    const dateChanged = before.date !== after.date;
    const caregiverChanged = !sameAssignment(before.assignment, after.assignment);
    const titleChanged = before.title !== after.title;
    return (
      <li key={op.shiftId} className="space-y-0.5 px-3 py-1.5 text-xs">
        <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
          <span className="tabular-nums">{shortDate(after.date)}</span>
          <span className="min-w-0 truncate">{after.title}</span>
          {before.recurring && (
            <span className="inline-flex items-center gap-0.5 font-normal text-muted-foreground">
              <Repeat2 className="h-3 w-3" aria-label="Recurring shift" />
              this occurrence only
            </span>
          )}
        </p>
        {(timeChanged || dateChanged || caregiverChanged || titleChanged) && (
          <p className="flex flex-wrap gap-x-3 text-muted-foreground tabular-nums">
            {timeChanged && <span>Time: {before.start}–{before.end} → {after.start}–{after.end}</span>}
            {dateChanged && <span>Moved from {shortDate(before.date)}</span>}
            {caregiverChanged && <span>Caregiver: {assignmentLabel(before.assignment)} → {assignmentLabel(after.assignment)}</span>}
            {titleChanged && <span>Name: {before.title} → {after.title}</span>}
          </p>
        )}
      </li>
    );
  };

  const conflictRow = (op: PublishPlanOp) => {
    const shift = shiftById.get(op.shiftId);
    return (
      <li key={op.shiftId} className="space-y-0.5 px-3 py-1.5 text-xs">
        <p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{shift ? shortDate(shift.date) : "Proposal"}</span>
          <span className="min-w-0 truncate">{shift ? shift.title : "Shift"}</span>
          {shift && <span className="font-normal tabular-nums">{shift.start}–{shift.end}</span>}
        </p>
        <p className="text-muted-foreground">
          {op.reason ?? "This proposal conflicts with the current calendar."} Return to the builder to revise or remove it; the existing calendar shift stays unchanged.
        </p>
      </li>
    );
  };

  const undoRemoval = async (id: string) => {
    if (loading || publishing) return;
    setLoading(true); setError("");
    try { await onUndoRemoval(id); await refresh(); }
    catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "Undo could not be saved."); setLoading(false); }
  };

  const excludeRow = (op: PublishPlanOp) => {
    const before = op.original;
    return (
      <li key={op.shiftId} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <span className="font-semibold tabular-nums">{before ? shortDate(before.date) : "Shift to remove"}</span>
          <span className="min-w-0 truncate">{before?.title ?? "Shift"}</span>
          <span className="font-normal tabular-nums text-muted-foreground">
            {before ? (before.allDay ? "All day" : `${before.start}–${before.end}`) : ""}
            {before ? ` · ${assignmentLabel(before.assignment)}` : ""}
          </span>
          {before?.recurring && <span className="font-normal text-muted-foreground">this occurrence only</span>}
        </p>
        <Button variant="outline" size="sm" className="h-6 shrink-0 px-2 text-xs" disabled={publishing || !!result} onClick={() => void undoRemoval(op.shiftId)}>
          Undo
        </Button>
      </li>
    );
  };

  const createRow = (op: PublishPlanOp) => {
    const shift = shiftById.get(op.shiftId);
    if (!shift) return null;
    return (
      <li key={op.shiftId} className="px-3 py-1.5 text-xs">
        <span className="font-semibold tabular-nums">{shortDate(shift.date)}</span>
        <span className="mx-1.5 min-w-0 truncate">{shift.title}</span>
        <span className="tabular-nums text-muted-foreground">{shift.start}–{shift.end} · {assignmentLabel(shift.assignment)}</span>
      </li>
    );
  };

  const listClass = "divide-y divide-border rounded-md border border-border";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review Schedule — {labelDate(`${month}-01`, { month: "long", year: "numeric" })}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <p className="text-xs text-muted-foreground">
            {timeZone} · Saved draft revision {preview?.revision ?? revision} · Private until published
          </p>

          {stale && preview && (
            <div role="alert" className="rounded-md border border-member-amber bg-member-amber-soft p-3 text-xs text-member-amber-ink">
              {dirty
                ? "You have unsaved draft changes. This review reflects the last saved draft — save the draft, then refresh the preview."
                : "The saved draft changed since this preview was made. Refresh the preview before reviewing."}
            </div>
          )}

          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading review…</p>}
          {error && !loading && (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void refresh()}>Retry</Button>
                <Button variant="ghost" onClick={onClose}>Return to builder</Button>
              </div>
            </div>
          )}

          {preview && groups && readiness && !loading && (
            <div className={cn("space-y-3", stale && "opacity-60")}>
              <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {([
                  ["New", groups.creates.length, "text-member-sage-ink"],
                  ["Changes", groups.updates.length, "text-member-amber-ink"],
                  ["Unchanged", groups.unchanged.length, "text-member-sky-ink"],
                  ["Kept existing", preview.plan.counts.preserved, "text-member-sky-ink"],
                  ["Conflicts", groups.conflicts.length, groups.conflicts.length > 0 ? "text-destructive" : ""],
                  ["Planned hours", Number(hours.toFixed(2)), ""],
                ] as const).map(([label, value, tone]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</dd>
                  </div>
                ))}
              </dl>

              {groups.conflicts.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-destructive">Needs attention ({groups.conflicts.length})</h3>
                  <ul className={listClass}>{groups.conflicts.map(conflictRow)}</ul>
                </section>
              )}

              {groups.updates.length > 0 && (
                <section className="space-y-1.5">
                  {groupHeader("Modified shifts", groups.updates, "Confirm all changes", "text-member-amber-ink")}
                  <ul className={listClass}>{groups.updates.map(updateRow)}</ul>
                </section>
              )}

              {groups.creates.length > 0 && (
                <section className="space-y-1.5">
                  {groupHeader("New shifts", groups.creates, "Confirm additions", "text-member-sage-ink")}
                  <ul className={listClass}>{groups.creates.map(createRow)}</ul>
                </section>
              )}

              {groups.excludes.length > 0 && (
                <section className="space-y-1.5">
                  {groupHeader("Removed shifts", groups.excludes, "Confirm removals", "text-destructive")}
                  <ul className={listClass}>{groups.excludes.map(excludeRow)}</ul>
                </section>
              )}

              <section className="space-y-1.5">
                <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setShowKept((v) => !v)}>
                  {showKept ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Existing shifts kept unchanged ({preview.plan.counts.preserved + groups.unchanged.length})
                </button>
                <p className="text-xs text-muted-foreground">
                  Existing shifts are kept unless explicitly selected and confirmed for removal.
                </p>
                {showKept && (
                  <ul className={cn(listClass, "text-xs")}>
                    {preview.plan.preserved.map((s) => (
                      <li key={s.key} className="flex flex-wrap items-center gap-x-1.5 px-3 py-1.5">
                        <span className="font-semibold tabular-nums">{shortDate(s.date)}</span>
                        <span className="min-w-0 truncate">{s.title}</span>
                        {s.recurring && <Repeat2 className="h-3 w-3" aria-label="Recurring shift" />}
                        <span className="font-normal tabular-nums text-muted-foreground">
                          {s.allDay ? "All day" : `${s.start}–${s.end}`} · {assignmentLabel(s.assignment)}
                        </span>
                      </li>
                    ))}
                    {preview.plan.preserved.length === 0 && groups.unchanged.length === 0 && (
                      <li className="px-3 py-1.5 text-muted-foreground">No other existing shifts this month.</li>
                    )}
                  </ul>
                )}
              </section>

              <section className="space-y-2 border-t border-border pt-3">
                {readiness.ready ? (
                  <p className="text-sm font-medium text-member-sage-ink">
                    Review complete — this draft is ready to publish when publishing arrives.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {readiness.blockers.map((b) => (
                      <li key={b} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-member-amber-ink" />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  When publishing arrives, saving to your family calendar completes first; Google sync finishes
                  separately afterward.
                </p>
              </section>
            </div>
          )}
        </div>
        {result && (
          <div className="space-y-1 rounded-md border border-border p-3 text-sm" role="status">
            <p className="font-medium">
              {result.needsAttention === 0
                ? `Saved to your family calendar: ${result.applied} applied, ${result.skipped} unchanged.`
                : `Saved with issues: ${result.applied} applied, ${result.needsAttention} need attention.`}
            </p>
            {result.conflicts.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
                {[...new Set(result.conflicts.map((c) => c.reason))].map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            {result.timesheetReconcile === "pending" && <p className="text-xs">Timesheet update is pending and will retry.</p>}
            <p className="text-xs text-muted-foreground">{googleLabel[result.google.status]}</p>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={onClose}>Return to builder</Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />Refresh preview
            </Button>
            {gateOpen ? (
              <Button disabled={loading || publishing || !!result || stale || !readiness?.ready} onClick={() => void publish()}>
                {publishing ? "Publishing…" : "Publish Schedule"}
              </Button>
            ) : (
              <Button disabled title="Publishing is coming soon">
                <LockKeyhole className="h-4 w-4" />Publish Schedule — Coming Soon
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
