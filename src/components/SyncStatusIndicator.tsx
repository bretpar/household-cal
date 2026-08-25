import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { getSyncSettings } from "@/lib/google.functions";

/**
 * Compact Google sync health chip for the app header. Owner-only: the server
 * function returns no connection details for editors/viewers, so they see
 * nothing here.
 */
export function SyncStatusIndicator() {
  const load = useServerFn(getSyncSettings);
  const { data } = useQuery({
    queryKey: ["calendar-sync"],
    queryFn: () => load(),
    refetchInterval: 60_000,
  });

  if (!data?.is_owner) return null;

  const connection = data.connection;
  const connected = Boolean(connection) && connection?.status === "connected";
  const error = connection?.last_error ?? null;

  let tone = "text-muted-foreground";
  let dot = "bg-muted-foreground/50";
  let label = "Sync off";
  let detail = "Google Calendar is not connected";

  const paused = (data.calendars ?? []).filter((c) => c.sync_status === "needs_attention");

  if (connection && !connected) {
    tone = "text-destructive";
    dot = "bg-destructive";
    label = "Sync issue";
    detail = error ?? "Google Calendar access has expired — reconnect Google to resume syncing";
  } else if (connected && paused.length > 0) {
    tone = "text-destructive";
    dot = "bg-destructive";
    label = "Sync needs attention";
    detail = `${paused[0]?.name ?? "A Google calendar"} can no longer be found. Your family events are safe; Google syncing is paused.`;
  } else if (connected) {
    tone = "text-foreground";
    dot = "bg-primary";
    label = connection?.last_synced_at
      ? `Synced ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}`
      : "Sync pending";
    detail = error
      ? `Last sync error: ${error}`
      : `Connected as ${connection?.account_email ?? "Google account"}`;
    if (error) {
      tone = "text-destructive";
      dot = "bg-destructive";
    }
  }

  return (
    <Link
      to="/family"
      title={detail}
      aria-label={`Google Calendar sync: ${label}. ${detail}`}
      className={`flex h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold transition-colors hover:bg-secondary ${tone}`}
    >
      {error || paused.length > 0 || (connection && !connected) ? (
        <AlertTriangle className="h-4 w-4" aria-hidden />
      ) : (
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
          <RefreshCw className="hidden h-3.5 w-3.5 sm:block" aria-hidden />
        </>
      )}
      <span className="hidden max-w-[9rem] truncate lg:inline">{label}</span>
    </Link>
  );
}
