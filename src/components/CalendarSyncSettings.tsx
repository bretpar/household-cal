import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CalendarPlus, Link2, RefreshCw, Star, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  completeGoogleCalendarConnection,
  connectCalendarSlot,
  disconnectCalendarSlot,
  disconnectGoogleAccount,
  getSyncSettings,
  listGoogleCalendars,
  renameCalendarSlot,
  setMainCalendarSlot,
  startGoogleCalendarConnect,
  syncNow,
} from "@/lib/google.functions";

const SYNC_KEY = ["calendar-sync"] as const;

/** Waits for the consent popup to hand back its one-time code. */
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
      )
        return;
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

export function CalendarSyncSettings() {
  const queryClient = useQueryClient();
  const load = useServerFn(getSyncSettings);
  const start = useServerFn(startGoogleCalendarConnect);
  const complete = useServerFn(completeGoogleCalendarConnection);
  const listCalendars = useServerFn(listGoogleCalendars);
  const attach = useServerFn(connectCalendarSlot);
  const rename = useServerFn(renameCalendarSlot);
  const makeMain = useServerFn(setMainCalendarSlot);
  const detach = useServerFn(disconnectCalendarSlot);
  const disconnect = useServerFn(disconnectGoogleAccount);
  const runSync = useServerFn(syncNow);

  const { data, isPending } = useQuery({ queryKey: SYNC_KEY, queryFn: () => load() });
  const [connecting, setConnecting] = useState(false);
  const [slotDialog, setSlotDialog] = useState<{ replaceId: string | null } | null>(null);
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [newName, setNewName] = useState("Family Calendar");
  const [chosen, setChosen] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SYNC_KEY });
    void queryClient.invalidateQueries({ queryKey: ["family-bundle"] });
  };

  const available = useQuery({
    queryKey: ["google-calendar-list"],
    queryFn: () => listCalendars(),
    enabled: Boolean(slotDialog) && Boolean(data?.connection),
  });

  const renameMutation = useMutation({
    mutationFn: (input: { data: { source_id: string; name: string } }) => rename(input),
    onSuccess: () => {
      toast.success("Calendar renamed");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const mainMutation = useMutation({
    mutationFn: (input: { data: { source_id: string } }) => makeMain(input),
    onSuccess: () => {
      toast.success("Main calendar updated");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const detachMutation = useMutation({
    mutationFn: (input: { data: { source_id: string } }) => detach(input),
    onSuccess: () => {
      toast.success("Calendar disconnected — your events are still here");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const attachMutation = useMutation({
    mutationFn: (input: Parameters<typeof attach>[0]) => attach(input),
    onSuccess: () => {
      toast.success("Calendar connected");
      setSlotDialog(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const syncMutation = useMutation({
    mutationFn: () => runSync({ data: {} }),
    onSuccess: () => {
      toast.success("Sync complete");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      toast.success("Google account disconnected");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function onConnect() {
    const popup = window.open("", "google-calendar-oauth", "width=600,height=720");
    if (!popup) {
      toast.error("Allow popups to connect Google Calendar.");
      return;
    }
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

  if (isPending || !data?.is_owner) return null;

  const connection = data.connection;
  const disconnected = connection && connection.status !== "connected";

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
        <RefreshCw className="h-4 w-4" aria-hidden />
        Calendar sync
      </h2>

      <div className="space-y-4 rounded-3xl border border-border-soft bg-card p-4 shadow-soft">
        {!connection ? (
          <div className="space-y-2">
            <p className="text-sm font-bold">Connect a Google account</p>
            <p className="text-xs text-muted-foreground">
              Two-way sync with up to two Google calendars. This can be a different Google account
              than the one you sign in with.
            </p>
            <Button onClick={onConnect} disabled={connecting} className="rounded-xl">
              <Link2 className="mr-2 h-4 w-4" aria-hidden />
              {connecting ? "Connecting…" : "Connect Google Calendar"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                  Google account {disconnected ? "" : "· Connected ✓"}
                </p>
                <p className="truncate text-sm font-bold">{connection.account_email}</p>
                <p className="text-xs text-muted-foreground">
                  {connection.last_synced_at
                    ? `Last synced ${formatDistanceToNow(new Date(connection.last_synced_at), { addSuffix: true })}`
                    : "Not synced yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Sync now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => disconnectMutation.mutate()}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {disconnected ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-muted p-3 text-xs font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
                Google Calendar access has expired or been disconnected. Reconnect Google to
                resume syncing. Your family events are safe in Our Family Calendar.
                <Button size="sm" className="rounded-xl" onClick={onConnect}>
                  Reconnect
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              {Array.from({ length: data.max_calendars }).map((_, index) => {
                const slot = data.calendars[index];
                return (
                  <div
                    key={slot?.id ?? `empty-${index}`}
                    className="space-y-2 rounded-2xl border border-border-soft p-3"
                  >
                    <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                      Calendar {index + 1}
                    </p>
                    {slot ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            defaultValue={slot.name}
                            className="h-10 min-w-0 flex-1 rounded-xl"
                            aria-label={`Calendar ${index + 1} name`}
                            onBlur={(e) => {
                              const name = e.target.value.trim();
                              if (name && name !== slot.name) {
                                renameMutation.mutate({
                                  data: { source_id: slot.id, name },
                                });
                              }
                            }}
                          />
                          {slot.is_main ? (
                            <span className="flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1.5 text-[11px] font-bold">
                              <Star className="h-3 w-3" aria-hidden />
                              Main
                            </span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              onClick={() =>
                                mainMutation.mutate({ data: { source_id: slot.id } })
                              }
                            >
                              Make main
                            </Button>
                          )}
                        </div>
                        {slot.sync_status === "needs_attention" ? (
                          <div className="space-y-2 rounded-2xl bg-surface-muted p-3">
                            <p className="flex items-start gap-2 text-xs font-bold">
                              <AlertTriangle
                                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                                aria-hidden
                              />
                              <span>
                                Calendar unavailable — sync paused. The Google Calendar previously
                                connected to this family can no longer be found. Your family events
                                are safe in Our Family Calendar.
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                className="rounded-xl"
                                onClick={() => {
                                  setSlotDialog({ replaceId: slot.id });
                                  setMode("existing");
                                }}
                              >
                                Choose another Google Calendar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={() => {
                                  setSlotDialog({ replaceId: slot.id });
                                  setMode("create");
                                }}
                              >
                                Create a new Google Calendar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {slot.last_synced_at
                              ? `Last successful sync ${formatDistanceToNow(new Date(slot.last_synced_at), { addSuffix: true })}`
                              : "Not synced yet"}
                            {slot.sync_error ? ` · retrying: ${slot.sync_error}` : ""}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => {
                              setSlotDialog({ replaceId: slot.id });
                              setMode("existing");
                            }}
                          >
                            Replace
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => detachMutation.mutate({ data: { source_id: slot.id } })}
                          >
                            <Unlink className="mr-2 h-3.5 w-3.5" aria-hidden />
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => {
                          setSlotDialog({ replaceId: null });
                          setMode("existing");
                        }}
                      >
                        <CalendarPlus className="mr-2 h-3.5 w-3.5" aria-hidden />
                        Add calendar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(slotDialog)} onOpenChange={(open) => !open && setSlotDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {slotDialog?.replaceId ? "Replace calendar" : "Add a Google calendar"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(["existing", "create"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  aria-pressed={mode === option}
                  className={
                    mode === option
                      ? "rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
                      : "rounded-xl border border-border-soft px-3 py-2 text-xs font-bold"
                  }
                >
                  {option === "existing" ? "Use existing" : "Create new"}
                </button>
              ))}
            </div>

            {mode === "existing" ? (
              <div className="space-y-1.5">
                <Label>Google calendar</Label>
                <Select value={chosen} onValueChange={setChosen}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder={available.isPending ? "Loading…" : "Choose one"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(available.data?.calendars ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.summary}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="new-calendar-name">Calendar name</Label>
                <Input
                  id="new-calendar-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setSlotDialog(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              disabled={attachMutation.isPending || (mode === "existing" && !chosen)}
              onClick={() => {
                const summary = (available.data?.calendars ?? []).find((c) => c.id === chosen);
                attachMutation.mutate({
                  data:
                    mode === "create"
                      ? {
                          mode: "create",
                          name: newName,
                          replace_source_id: slotDialog?.replaceId ?? null,
                        }
                      : {
                          mode: "existing",
                          external_calendar_id: chosen,
                          name: summary?.summary ?? chosen,
                          replace_source_id: slotDialog?.replaceId ?? null,
                        },
                });
              }}
            >
              {attachMutation.isPending ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
