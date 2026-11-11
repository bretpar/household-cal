import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronDown, ChevronUp, LockKeyhole, RefreshCw, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Assignment, ExistingShift, ScheduleDraft } from "@/lib/schedule-builder";
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

/**
 * Desktop Review & Publish dialog for the Babysitter Schedule Builder.
 * Read-only: it classifies the saved draft through the owner-authorized
 * server preview and collects explicit confirmation for modifications.
 * Publishing itself stays disabled — no calendar, Google, or Timesheet
 * writes happen here.
 */
export function ScheduleReviewDialog({ familyId, month, draft, revision, dirty, existing, members, timeZone, onClose }: {
  familyId: string;
  month: string;
  draft: ScheduleDraft;
  revision: number;
  dirty: boolean;
  existing: ExistingShift[];
  members: FamilyMember[];
  timeZone: string;
  onClose: () => void;
}) {
  const loadPreview = useServerFn(planSchedulePublish);
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
      setPreview(await loadRef.current({ data: { familyId, month } }));
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

  const shiftById = useMemo(() => new Map(draft.shifts.map((s) => [s.id, s])), [draft]);
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

  const toggleConfirmed = (shiftId: string, checked: boolean) =>
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (checked) next.add(shiftId);
      else next.delete(shiftId);
      return next;
    });

  const updateRow = (op: PublishPlanOp) => {
    const after = shiftById.get(op.shiftId);
    // Server-reviewed, version-bound original only; never builder-cached data.
    const before = originalVerified(op) ? op.original! : undefined;
    const isConfirmed = confirmed.has(op.shiftId);
    return (
      <article key={op.shiftId} className="rounded-md border border-member-amber bg-member-amber-soft p-3 text-member-amber-ink">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1 text-xs">
            <p className="font-semibold">
              {shortDate(after?.date ?? op.occurrenceDate ?? `${month}-01`)} · {after?.title ?? before?.title ?? "Shift"}
            </p>
            {before?.recurring && (
              <p className="flex items-center gap-1">
                <Repeat2 className="h-3 w-3 shrink-0" aria-label="Recurring shift" />
                Only this occurrence ({shortDate(op.occurrenceDate ?? before.date)}) changes — the rest of the series stays unchanged.
              </p>
            )}
            <p className="tabular-nums">
              Time: {before ? `${before.start}–${before.end}` : "—"} → {after ? `${after.start}–${after.end}` : "—"}
              {before && after && before.date !== after.date && ` (moved from ${shortDate(before.date)})`}
            </p>
            <p>Caregiver: {before ? assignmentLabel(before.assignment) : "—"} → {after ? assignmentLabel(after.assignment) : "—"}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
            <Checkbox
              aria-label={`Confirm change to ${after?.title ?? "shift"} on ${op.occurrenceDate ?? after?.date ?? ""}`}
              checked={isConfirmed}
              onCheckedChange={(c) => toggleConfirmed(op.shiftId, c === true)}
            />
            Confirm change
          </label>
        </div>
      </article>
    );
  };

  const conflictRow = (op: PublishPlanOp) => {
    const shift = shiftById.get(op.shiftId);
    return (
      <article key={op.shiftId} className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
        <p className="flex items-center gap-1 font-semibold">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {shift ? `${shortDate(shift.date)} · ${shift.title} · ${shift.start}–${shift.end}` : "Proposal"}
        </p>
        <p>{op.reason ?? "This proposal conflicts with the current calendar."}</p>
        <p>Return to the builder to revise or remove this proposal. The existing calendar shift stays unchanged.</p>
      </article>
    );
  };

  const excludeRow = (op: PublishPlanOp) => (
    <article key={op.shiftId} className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
      <p className="flex items-center gap-1 font-semibold">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Removing an existing calendar occurrence is not supported.
      </p>
      <p>The existing shift{op.occurrenceDate ? ` on ${shortDate(op.occurrenceDate)}` : ""} stays unchanged. Return to the builder to revise this proposal.</p>
    </article>
  );

  const createRow = (op: PublishPlanOp) => {
    const shift = shiftById.get(op.shiftId);
    if (!shift) return null;
    return (
      <article key={op.shiftId} className="rounded-md border border-member-sage bg-member-sage-soft p-3 text-xs text-member-sage-ink">
        <p className="font-semibold">{shortDate(shift.date)} · {shift.title}</p>
        <p className="tabular-nums">{shift.start}–{shift.end} · {assignmentLabel(shift.assignment)}</p>
      </article>
    );
  };

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
            <div className={cn("space-y-4", stale && "opacity-60")}>
              <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {([
                  ["New", groups.creates.length, "text-member-sage-ink"],
                  ["Changes", groups.updates.length, "text-member-amber-ink"],
                  ["Unchanged", groups.unchanged.length, "text-member-sky-ink"],
                  ["Kept existing", preview.plan.counts.preserved, "text-member-sky-ink"],
                  ["Conflicts", groups.conflicts.length + groups.excludes.length, groups.conflicts.length + groups.excludes.length > 0 ? "text-destructive" : ""],
                  ["Planned hours", Number(hours.toFixed(2)), ""],
                ] as const).map(([label, value, tone]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</dd>
                  </div>
                ))}
              </dl>

              {(groups.conflicts.length > 0 || groups.excludes.length > 0) && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Needs attention</h3>
                  {groups.conflicts.map(conflictRow)}
                  {groups.excludes.map(excludeRow)}
                </section>
              )}

              {groups.updates.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Changes to existing shifts — confirm each one</h3>
                  {groups.updates.map(updateRow)}
                </section>
              )}

              {groups.creates.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">New shifts</h3>
                  {groups.creates.map(createRow)}
                </section>
              )}

              <section className="space-y-2">
                <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setShowKept((v) => !v)}>
                  {showKept ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Existing shifts kept unchanged ({preview.plan.counts.preserved + groups.unchanged.length})
                </button>
                <p className="text-xs text-muted-foreground">
                  Existing shifts are always kept by default. Removing a calendar occurrence — including a single
                  occurrence of a recurring series — isn’t supported by the schedule builder.
                </p>
                {showKept && (
                  <div className="space-y-2">
                    {preview.plan.preserved.map((s) => (
                      <article key={s.key} className="rounded-md border border-member-sky bg-member-sky-soft p-3 text-xs text-member-sky-ink">
                        <p className="flex items-center gap-1 font-semibold">
                          {shortDate(s.date)} · {s.title}
                          {s.recurring && <Repeat2 className="h-3 w-3" aria-label="Recurring shift" />}
                        </p>
                        <p className="tabular-nums">{s.allDay ? "All day" : `${s.start}–${s.end}`} · {assignmentLabel(s.assignment)}</p>
                      </article>
                    ))}
                    {preview.plan.preserved.length === 0 && groups.unchanged.length === 0 && (
                      <p className="text-xs text-muted-foreground">No other existing shifts this month.</p>
                    )}
                  </div>
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
