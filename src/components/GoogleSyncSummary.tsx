import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getSyncSettings, syncNow } from "@/lib/google.functions";

const SYNC_KEY = ["calendar-sync"] as const;

/**
 * Compact sync status card at the top of Settings: connection state, last
 * successful sync and an always-visible Sync now button. Uses the existing
 * sync server functions — no behavior changes.
 */
export function GoogleSyncSummary() {
  const queryClient = useQueryClient();
  const load = useServerFn(getSyncSettings);
  const runSync = useServerFn(syncNow);
  const wasSyncing = useRef(false);

  const { data, isPending } = useQuery({
    queryKey: SYNC_KEY,
    queryFn: () => load(),
    refetchInterval: (query) =>
      query.state.data?.connection?.manual_sync_running ? 1_500 : false,
  });

  const syncMutation = useMutation({
    mutationFn: () => runSync({ data: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SYNC_KEY });
    },
    onError: () => toast.error("Couldn’t start sync. Try again."),
  });

  const syncing = syncMutation.isPending || Boolean(data?.connection?.manual_sync_running);
  useEffect(() => {
    if (wasSyncing.current && !syncing && !data?.connection?.manual_sync_error) {
      void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
    }
    wasSyncing.current = syncing;
  }, [data?.connection?.manual_sync_error, queryClient, syncing]);

  if (isPending || !data?.is_owner) return null;

  const connection = data.connection;
  const connected = Boolean(connection) && connection?.status === "connected";
  const needsAttention = (data.calendars ?? []).some((c) => c.sync_status === "needs_attention");

  const statusLabel = !connection
    ? "Not connected"
    : !connected
      ? "Reconnect needed"
      : syncing
        ? "Syncing…"
      : needsAttention
        ? "Needs attention"
        : "Connected";

  const lastSync = connection?.last_synced_at
    ? `Last synced ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}`
    : "Not synced yet";

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        <RefreshCw className="h-4 w-4" aria-hidden />
        Google Calendar sync
      </h2>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border-soft bg-card p-4 shadow-soft">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold">
            {connected && !needsAttention ? (
              <span className="bg-success h-2 w-2 shrink-0 rounded-full" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
            )}
            {statusLabel}
            {connection?.account_email ? (
              <span className="truncate text-xs font-semibold text-muted-foreground">
                · {connection.account_email}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connection ? lastSync : "Connect Google in Calendar sync details to start syncing"}
          </p>
          {connection?.manual_sync_error ? (
            <p className="mt-1 text-xs font-semibold text-destructive">
              {connection.manual_sync_error}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => syncMutation.mutate()}
          disabled={syncing || !connection}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
    </section>
  );
}
