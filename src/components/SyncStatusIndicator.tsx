import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSyncSettings, syncNow } from "@/lib/google.functions";

const SYNC_KEY = ["calendar-sync"] as const;

/**
 * Compact Google sync health chip for the app header. Owner-only: the server
 * function returns no connection details for editors/viewers, so they see
 * nothing here.
 */
export function SyncStatusIndicator() {
  const queryClient = useQueryClient();
  const load = useServerFn(getSyncSettings);
  const runSync = useServerFn(syncNow);
  const { data } = useQuery({
    queryKey: SYNC_KEY,
    queryFn: () => load(),
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => runSync({ data: {} }),
    onSuccess: () => {
      toast.success("Sync complete");
      void queryClient.invalidateQueries({ queryKey: SYNC_KEY });
      void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!data?.is_owner) return null;

  const connection = data.connection;
  const connected = Boolean(connection) && connection?.status === "connected";
  const calendarError = data.calendars.find((calendar) => calendar.sync_error)?.sync_error;
  const error = connection?.last_error ?? calendarError ?? null;
  const needsSync =
    !connection ||
    !connected ||
    !connection.last_synced_at ||
    data.calendars.some((calendar) => calendar.sync_status === "needs_attention");
  const status = syncMutation.isPending
    ? { label: "Syncing…", dot: "bg-warning", tone: "text-warning-foreground" }
    : error
      ? { label: "Sync issue", dot: "bg-destructive", tone: "text-destructive" }
      : needsSync
        ? { label: "Needs sync", dot: "bg-warning", tone: "text-warning-foreground" }
        : { label: "Synced", dot: "bg-success", tone: "text-foreground" };
  const lastSync = connection?.last_synced_at
    ? `Last successful sync ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}`
    : "No successful sync yet";
  const detail = error
    ? error
    : connection
      ? connected
        ? "Google Calendar is connected"
        : "Google Calendar needs to be reconnected"
      : "Google Calendar is not connected";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={detail}
          aria-label={`Google Calendar sync: ${status.label}. ${detail}`}
          className={`h-11 rounded-full px-2.5 text-xs font-semibold sm:px-3 ${status.tone}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
          <span>{status.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[min(18rem,calc(100vw-2rem))] space-y-4 rounded-lg">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-bold">
            <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
            {status.label}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
          {connection?.account_email ? (
            <p className="truncate text-xs font-semibold" title={connection.account_email}>
              {connection.account_email}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{lastSync}</p>
        </div>
        {connection && connected ? (
          <Button
            type="button"
            size="sm"
            className="w-full rounded-md"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className={syncMutation.isPending ? "animate-spin" : ""} aria-hidden />
            {syncMutation.isPending ? "Syncing…" : "Sync now"}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
