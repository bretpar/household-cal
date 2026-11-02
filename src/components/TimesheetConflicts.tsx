import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { TimesheetEntry } from "@/lib/timesheets.functions";

/**
 * Conflicts block submission. Suspected legacy duplicates remain counted until
 * an Owner decides; proven duplicates and moved orphan entries do not count.
 */
export function TimesheetConflicts({
  entries,
  onResolve,
  ownerReview = false,
}: {
  /** duplicates of finalized shifts are resolvable only by an Owner */
  ownerReview?: boolean;
  entries: TimesheetEntry[];
  /** omitted = read-only notice */
  onResolve?: ((entryId: string, action: "keep" | "discard") => Promise<unknown>) | undefined;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const flagged = entries.filter((e) => e.schedule_conflict_at);
  if (!flagged.length) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden /> A shift was moved on the calendar
      </p>
      <p className="text-xs text-muted-foreground">
        Confirmed duplicates and moved shifts aren't counted. Suspected matches remain counted and need a parent's review before submission.
      </p>
      <ul className="space-y-2">
        {flagged.map((e) => {
          const moved = e.schedule_conflict_reason === "moved";
          const suspected = e.schedule_conflict_reason === "suspected_duplicate";
          return (
            <li key={e.id} className="rounded-xl bg-card px-3 py-2">
              <p className="font-semibold">
                {e.work_date} · {e.actual_start_local}–{e.actual_end_local}
              </p>
              <p className="text-xs text-muted-foreground">
                {moved
                  ? "This shift's scheduled date changed after time was entered."
                  : suspected
                    ? "The timing resembles historical work, but duplication isn't confirmed. These hours remain counted until a parent reviews them."
                  : ownerReview
                    ? "This shift may already be on a submitted or approved timesheet. Choose whether to count it."
                    : "This shift may already be on a submitted or approved timesheet. A parent will review it."}
              </p>
              {onResolve && (moved || ownerReview) ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(e.id);
                      try { await onResolve(e.id, "keep"); } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update"); }
                      finally { setBusy(null); }
                    }}
                  >
                    {moved ? "Keep as worked time" : "Count this shift"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(e.id);
                      try { await onResolve(e.id, "discard"); } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update"); }
                      finally { setBusy(null); }
                    }}
                  >
                    {moved ? "Remove" : "Don't count"}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
