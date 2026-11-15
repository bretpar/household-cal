import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SyncStatusControl } from "@/components/SyncStatusIndicator";
import { getCaregiverGoogle, syncCaregiverGoogle } from "@/lib/caregiver-google.functions";

export function CaregiverSyncStatusIndicator({ userId }: { userId: string }) {
  const load = useServerFn(getCaregiverGoogle);
  const sync = useServerFn(syncCaregiverGoogle);
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["caregiver-google", userId], queryFn: () => load(), staleTime: 30000, refetchInterval: 30000 });
  const mutation = useMutation({ mutationFn: () => sync(), onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["caregiver-google", userId] });
  }, onError: () => toast.error("Couldn’t sync your work calendar. Try again.") });
  const connection = statusQuery.data?.connection;
  if (!connection || connection.status === "disconnected") return null;
  const connected = connection.status === "connected" && Boolean(connection.calendar_id);
  const issue = statusQuery.isError || Boolean(statusQuery.data?.issues) || connection.status === "reconnect_required" || mutation.isError;
  const pending = Boolean(statusQuery.data?.pending || statusQuery.data?.moving);
  const status = mutation.isPending
    ? { label: "Syncing…", dot: "bg-warning", tone: "text-warning-foreground" }
    : issue ? { label: "Sync issue", dot: "bg-destructive", tone: "text-destructive" }
    : pending || !connected ? { label: "Needs sync", dot: "bg-warning", tone: "text-warning-foreground" }
    : { label: "Synced", dot: "bg-success", tone: "text-foreground" };
  const detail = connection.status === "reconnect_required" ? "Reconnect your Google Calendar in Settings."
    : mutation.isError ? "Couldn’t sync your work calendar. Try again."
    : statusQuery.isError ? "Could not check sync status. Try again."
    : statusQuery.data?.issues ? `${statusQuery.data.issues} work shifts need attention. Sync now to retry.`
    : statusQuery.data?.moving ? "Moving calendars. Previous-calendar cleanup is still pending."
    : pending ? `${statusQuery.data?.pending ?? 0} work shifts pending sync.`
    : !connected ? "Choose your Google Calendar in Settings." : "Your work Google Calendar is connected.";
  return <SyncStatusControl status={status} detail={detail} accountEmail={connection.account_email}
    connected={connected} syncing={mutation.isPending} onSync={() => mutation.mutate()} />;
}