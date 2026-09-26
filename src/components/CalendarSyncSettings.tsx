import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Link2, RefreshCw, Star, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  completeGoogleCalendarConnection,
  connectCalendarSlot,
  disconnectCalendarSlot,
  disconnectGoogleAccount,
  getSyncSettings,
  listGoogleCalendars,
  renameCalendarSlot,
  setMainCalendarSlot,
  setGoogleEventTitleInitials,
  startGoogleCalendarConnect,
  syncNow,
} from "@/lib/google.functions";
import { cn } from "@/lib/utils";

export const SYNC_KEY = ["calendar-sync"] as const;

function waitForOAuth(popup: Window): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "google_calendar" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("Google did not finish connecting."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("The Google window closed before finishing."));
    }, 500);
  });
}

function useGoogleSettings() {
  const load = useServerFn(getSyncSettings);
  return useQuery({
    queryKey: SYNC_KEY,
    queryFn: () => load(),
    refetchInterval: (query) =>
      query.state.data?.connection?.manual_sync_running ? 1_500 : false,
  });
}

function useGoogleRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: SYNC_KEY });
    void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
  };
}

export function GoogleAccountSettings() {
  const queryClient = useQueryClient();
  const settings = useGoogleSettings();
  const refresh = useGoogleRefresh();
  const start = useServerFn(startGoogleCalendarConnect);
  const complete = useServerFn(completeGoogleCalendarConnection);
  const setTitleInitials = useServerFn(setGoogleEventTitleInitials);
  const disconnect = useServerFn(disconnectGoogleAccount);
  const runSync = useServerFn(syncNow);
  const [expanded, setExpanded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const wasSyncing = useRef(false);

  const titleMutation = useMutation({
    mutationFn: (enabled: boolean) => setTitleInitials({ data: { enabled } }),
    onSuccess: () => { toast.success("Google event titles updated"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const syncMutation = useMutation({
    mutationFn: () => runSync({ data: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SYNC_KEY }),
    onError: () => toast.error("Couldn’t start sync. Try again."),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => { toast.success("Google account disconnected"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const connection = settings.data?.connection;
  const syncing = syncMutation.isPending || Boolean(connection?.manual_sync_running);
  useEffect(() => {
    if (wasSyncing.current && !syncing && !connection?.manual_sync_error) {
      void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
    }
    wasSyncing.current = syncing;
  }, [connection?.manual_sync_error, queryClient, syncing]);

  async function onConnect() {
    const popup = window.open("", "google-calendar-oauth", "width=600,height=720");
    if (!popup) { toast.error("Allow popups to connect Google Calendar."); return; }
    setConnecting(true);
    try {
      const { authorizationUrl } = await start();
      const pending = waitForOAuth(popup);
      popup.location.href = authorizationUrl;
      const code = await pending;
      if (code) await complete({ data: { code } });
      toast.success("Google Calendar connected");
      refresh();
    } catch (error) {
      popup.close();
      toast.error(error instanceof Error ? error.message : "Could not connect Google Calendar");
    } finally {
      setConnecting(false);
    }
  }

  if (settings.isPending || !settings.data?.is_owner) return null;
  const disconnected = connection && connection.status !== "connected";

  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
      <Button
        type="button"
        variant="ghost"
        className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-none p-3 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold">Google account</p>
          <p className="truncate text-xs text-muted-foreground">
            {connection ? `${connection.account_email} · ${disconnected ? "Needs attention" : "Connected"}` : "Not connected"}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden />
      </Button>
      {expanded ? (
        <div className="space-y-3 border-t border-border-soft p-3">
          {!connection ? (
            <Button onClick={onConnect} disabled={connecting} className="w-full sm:w-auto">
              <Link2 className="h-4 w-4" aria-hidden />
              {connecting ? "Connecting…" : "Connect Google account"}
            </Button>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncing}>
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden />
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                  Disconnect account
                </Button>
                {disconnected ? <Button size="sm" onClick={onConnect}>Reconnect</Button> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {connection.last_synced_at ? `Last synced ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}` : "Not synced yet"}
              </p>
              {connection.manual_sync_error ? <p className="text-xs font-semibold text-destructive">{connection.manual_sync_error}</p> : null}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border-soft pt-3">
                <Label htmlFor="google-event-title-initials" className="min-w-0 text-sm font-semibold">
                  Include family initials in Google event titles
                </Label>
                <Switch
                  id="google-event-title-initials"
                  checked={settings.data.include_google_event_initials}
                  disabled={titleMutation.isPending}
                  onCheckedChange={(enabled) => titleMutation.mutate(enabled)}
                />
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function GoogleCalendarControls({ sourceId }: { sourceId: string }) {
  const settings = useGoogleSettings();
  const refresh = useGoogleRefresh();
  const rename = useServerFn(renameCalendarSlot);
  const makeMain = useServerFn(setMainCalendarSlot);
  const detach = useServerFn(disconnectCalendarSlot);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const slot = settings.data?.calendars.find((calendar) => calendar.id === sourceId);

  const renameMutation = useMutation({
    mutationFn: (name: string) => rename({ data: { source_id: sourceId, name } }),
    onSuccess: () => { toast.success("Calendar renamed"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const mainMutation = useMutation({
    mutationFn: () => makeMain({ data: { source_id: sourceId } }),
    onSuccess: () => { toast.success("Main calendar updated"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const detachMutation = useMutation({
    mutationFn: () => detach({ data: { source_id: sourceId } }),
    onSuccess: () => { toast.success("Calendar disconnected — your events are still here"); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!slot || !settings.data?.is_owner) return null;
  return (
    <div className="space-y-2 border-t border-border-soft pt-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Google calendar</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {slot.sync_status === "needs_attention" ? "Sync needs attention" : slot.last_synced_at ? `Synced ${formatDistanceToNow(new Date(slot.last_synced_at), { addSuffix: true })}` : "Not synced yet"}
          </p>
        </div>
        {slot.is_main ? <span className="flex shrink-0 items-center gap-1 text-xs font-bold"><Star className="h-3.5 w-3.5" aria-hidden /> Main</span> : null}
      </div>
      {slot.sync_error ? <p className="text-xs font-semibold text-destructive">{slot.sync_error}</p> : null}
      <Input
        defaultValue={slot.name}
        aria-label={`Google calendar name for ${slot.name}`}
        className="h-9"
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name && name !== slot.name) renameMutation.mutate(name);
        }}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!slot.is_main ? <Button size="sm" variant="outline" onClick={() => mainMutation.mutate()}>Make main</Button> : null}
        <Button size="sm" variant="outline" onClick={() => setReplaceOpen(true)}>Replace</Button>
        <Button size="sm" variant="ghost" onClick={() => detachMutation.mutate()} disabled={detachMutation.isPending}>
          <Unlink className="h-3.5 w-3.5" aria-hidden /> Disconnect
        </Button>
      </div>
      <GoogleCalendarDialog open={replaceOpen} onOpenChange={setReplaceOpen} replaceSourceId={sourceId} />
    </div>
  );
}

export function GoogleCalendarDialog({
  open,
  onOpenChange,
  initialMode = "existing",
  replaceSourceId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: "existing" | "create";
  replaceSourceId?: string | null;
}) {
  const settings = useGoogleSettings();
  const refresh = useGoogleRefresh();
  const listCalendars = useServerFn(listGoogleCalendars);
  const attach = useServerFn(connectCalendarSlot);
  const [mode, setMode] = useState<"existing" | "create">(initialMode);
  const [newName, setNewName] = useState("Family Calendar");
  const [chosen, setChosen] = useState("");

  useEffect(() => { if (open) setMode(initialMode); }, [initialMode, open]);
  const available = useQuery({
    queryKey: ["google-calendar-list"],
    queryFn: () => listCalendars(),
    enabled: open && Boolean(settings.data?.connection),
  });
  const attachMutation = useMutation({
    mutationFn: (input: Parameters<typeof attach>[0]) => attach(input),
    onSuccess: () => { toast.success("Calendar connected"); onOpenChange(false); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const atLimit = !replaceSourceId && (settings.data?.calendars.length ?? 0) >= (settings.data?.max_calendars ?? 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{replaceSourceId ? "Replace Google calendar" : mode === "create" ? "Create Google calendar" : "Connect Google calendar"}</DialogTitle>
          {!settings.data?.connection ? <DialogDescription>Connect a Google account first.</DialogDescription> : atLimit ? <DialogDescription>You can connect up to two Google calendars.</DialogDescription> : null}
        </DialogHeader>
        {settings.data?.connection && !atLimit ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>Use existing</Button>
              <Button type="button" size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>Create new</Button>
            </div>
            {mode === "existing" ? (
              <div className="space-y-1.5">
                <Label>Google calendar</Label>
                <Select value={chosen} onValueChange={setChosen}>
                  <SelectTrigger className="h-11"><SelectValue placeholder={available.isPending ? "Loading…" : "Choose one"} /></SelectTrigger>
                  <SelectContent>{(available.data?.calendars ?? []).map((calendar) => <SelectItem key={calendar.id} value={calendar.id}>{calendar.summary}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="new-google-calendar-name">Calendar name</Label>
                <Input id="new-google-calendar-name" value={newName} onChange={(event) => setNewName(event.target.value)} className="h-11" />
              </div>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {settings.data?.connection && !atLimit ? (
            <Button
              disabled={attachMutation.isPending || (mode === "existing" ? !chosen : !newName.trim())}
              onClick={() => {
                const selected = (available.data?.calendars ?? []).find((calendar) => calendar.id === chosen);
                attachMutation.mutate({ data: mode === "create"
                  ? { mode: "create", name: newName, replace_source_id: replaceSourceId }
                  : { mode: "existing", external_calendar_id: chosen, name: selected?.summary ?? chosen, replace_source_id: replaceSourceId }
                });
              }}
            >{attachMutation.isPending ? "Connecting…" : mode === "create" ? "Create and connect" : "Connect"}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kept as a compatibility wrapper for any older call sites. */
export function CalendarSyncSettings() {
  return <GoogleAccountSettings />;
}
