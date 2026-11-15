import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCaregiverGoogle, startCaregiverGoogle, completeCaregiverGoogle, listCaregiverGoogleCalendars, selectCaregiverGoogleCalendar, syncCaregiverGoogle, disconnectCaregiverGoogle } from "@/lib/caregiver-google.functions";
import { waitForOAuth } from "@/components/CalendarSyncSettings";
import { isNativeApp } from "@/lib/native-auth";
import { createCaregiverOAuthProof, openCaregiverNativeOAuth } from "@/lib/caregiver-google-native";

export function CaregiverGoogleSettings({ userId }: { userId: string }) {
  const load = useServerFn(getCaregiverGoogle);
  const list = useServerFn(listCaregiverGoogleCalendars);
  const start = useServerFn(startCaregiverGoogle);
  const complete = useServerFn(completeCaregiverGoogle);
  const choose = useServerFn(selectCaregiverGoogleCalendar);
  const sync = useServerFn(syncCaregiverGoogle);
  const disconnect = useServerFn(disconnectCaregiverGoogle);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const status = useQuery({ queryKey: ["caregiver-google", userId], queryFn: () => load(), refetchInterval: 30000 });
  const calendars = useQuery({ queryKey: ["caregiver-google-calendars", userId, status.data?.connection?.status], queryFn: () => list(), enabled: status.data?.connection?.status === "connected" });
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    try { await action(); await status.refetch(); await calendars.refetch(); toast.success(message, { duration: 2000 }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Google Calendar action failed"); }
    finally { setBusy(false); }
  };
  const connect = () => {
    if (busy) return;
    if (isNativeApp()) {
      void run(async () => {
        const proof = await createCaregiverOAuthProof();
        const auth = await start({ data: { challenge: proof.challenge, native: true } });
        await openCaregiverNativeOAuth({ userId, attempt: auth.attempt, state: auth.state, verifier: proof.verifier }, auth.authorizationUrl);
      }, "Continue connecting in Google");
      return;
    }
    const popup = window.open("", "caregiver-google-oauth", "width=600,height=720");
    if (!popup) { toast.error("Allow popups to connect Google Calendar"); return; }
    void run(async () => {
      try {
        const proof = await createCaregiverOAuthProof();
        const { authorizationUrl, attempt } = await start({ data: { challenge: proof.challenge, native: false } });
        const pending = waitForOAuth(popup);
        popup.location.href = authorizationUrl;
        const code = await pending;
        if (!code || code !== attempt) throw new Error("Google authorization did not match this attempt");
        await complete({ data: { attempt, verifier: proof.verifier } });
      } catch (e) { popup.close(); throw e; }
    }, "Google Calendar connected");
  };
  const connection = status.data?.connection;
  return <section className="space-y-3 border-t border-border-soft pt-5">
    <h2 className="text-lg font-bold">Google Calendar</h2>
    {status.isError ? <p role="alert" className="text-destructive">Could not load your Google connection.</p> : null}
    <p className="text-sm text-muted-foreground">{connection?.status === "connected" ? `${connection.account_email ?? "Google account"} · ${connection.calendar_name ?? "Choose a work calendar"}` : "Not connected"}</p>
    {!connection || connection.status !== "connected" ? <Button onClick={connect} disabled={busy}><Link2 className="size-4" />{connection?.status === "reconnect_required" ? "Reconnect Google" : "Connect Google"}</Button> : <>
      {!connection.calendar_id && <div className="flex flex-wrap gap-2">
        <Select value={selected} onValueChange={setSelected}><SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Work calendar" /></SelectTrigger><SelectContent>{(calendars.data ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.summary}</SelectItem>)}</SelectContent></Select>
        <Button disabled={busy || !selected} onClick={() => void run(() => choose({ data: { calendarId: selected } }), "Work calendar connected")}>Use calendar</Button>
      </div>}
      {calendars.isError && <p role="alert" className="text-sm text-destructive">Could not load Google calendars. Reconnect if access has expired.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !connection.calendar_id} onClick={() => void run(() => sync(), "Sync checked")}><RefreshCw className="size-4" />Sync now</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => disconnect(), "Google disconnected")}><Unlink className="size-4" />Disconnect</Button></div>
      <p className="text-sm text-muted-foreground">{status.isFetching ? "Checking sync status…" : status.data?.issues ? `${status.data.issues} shifts need sync attention` : status.data?.pending ? `${status.data.pending} shifts pending sync` : connection.calendar_id ? "Synced" : "Not syncing yet"}</p>
    </>}
  </section>;
}