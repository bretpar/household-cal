import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { TimesheetEntry } from "@/lib/timesheets.functions";

/**
 * Lists shifts flagged by a calendar move. Flagged entries never count toward
 * totals and block submission until someone explicitly keeps or removes them.
 */
export function TimesheetConflicts({
  entries,
  onResolve,
}: {
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
        These hours aren't counted until resolved, so the same shift is never paid twice.
      </p>
      <ul className="space-y-2">
        {flagged.map((e) => {
          const moved = e.schedule_conflict_reason === "moved";
          return (
            <li key={e.id} className="rounded-xl bg-card px-3 py-2">
              <p className="font-semibold">
                {e.work_date} · {e.actual_start_local}–{e.actual_end_local}
              </p>
              <p className="text-xs text-muted-foreground">
                {moved
                  ? "This shift's scheduled date changed after time was entered."
                  : "This shift is already on a submitted or approved timesheet."}
              </p>
              {onResolve ? (
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
