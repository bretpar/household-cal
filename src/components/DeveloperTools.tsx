import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { repairGoogleRecurrence } from "@/lib/google.functions";
import { getQaAccess, runQaReset } from "@/lib/qa.functions";

/**
 * Developer / test-only panel. It renders nothing at all unless the signed-in
 * user is one of the dedicated QA owner accounts (checked server-side).
 */
export function DeveloperTools() {
  const queryClient = useQueryClient();
  const fetchAccess = useServerFn(getQaAccess);
  const reset = useServerFn(runQaReset);
  const [confirm, setConfirm] = useState("");

  const access = useQuery({ queryKey: ["qa-access"], queryFn: () => fetchAccess() });

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

  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { confirm } }),
    onSuccess: async (summary) => {
      setConfirm("");
      await queryClient.invalidateQueries();
      toast.success(
        `QA baseline restored · ${summary.deleted.events} events and ${summary.deleted.activities} activities cleared`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "QA reset failed"),
  });

  if (!access.data?.authorized) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        <FlaskConical className="h-4 w-4" aria-hidden />
        Developer / test tools
      </h2>
      <div className="space-y-4 rounded-3xl border border-dashed border-border bg-card p-4">
        <div>
          <h3 className="text-base font-bold">Reset QA Household</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Deletes test calendar data and restores the Parker Family QA baseline. Test accounts are
            preserved.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="qa-confirm">Type RESET to confirm</Label>
            <Input
              id="qa-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="RESET"
              autoComplete="off"
              className="h-11 rounded-xl"
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            className="h-11 rounded-full font-bold"
            disabled={confirm.trim().toUpperCase() !== "RESET" || resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            {resetMutation.isPending ? "Resetting…" : "Reset QA Household"}
          </Button>
        </div>
      </div>
      <div className="space-y-3 rounded-3xl border border-dashed border-border bg-card p-4">
        <div>
          <h3 className="text-base font-bold">Repair Google recurrence rules</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-reads repeat rules from Google for linked recurring events and restores weekdays lost
            by older imports. Safe to run more than once.
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
    </section>
  );
}
