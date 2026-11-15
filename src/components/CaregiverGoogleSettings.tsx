import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Plus, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCaregiverGoogleCalendar, getCaregiverGoogle, startCaregiverGoogle, completeCaregiverGoogle, listCaregiverGoogleCalendars, selectCaregiverGoogleCalendar, syncCaregiverGoogle, disconnectCaregiverGoogle } from "@/lib/caregiver-google.functions";
import { waitForOAuth } from "@/components/CalendarSyncSettings";
import { isNativeApp } from "@/lib/native-auth";
import { createCaregiverOAuthProof, openCaregiverNativeOAuth } from "@/lib/caregiver-google-native";

export function CaregiverGoogleSettings({ userId }: { userId: string }) {
  const load = useServerFn(getCaregiverGoogle);
  const list = useServerFn(listCaregiverGoogleCalendars);
  const start = useServerFn(startCaregiverGoogle);
  const complete = useServerFn(completeCaregiverGoogle);
  const choose = useServerFn(selectCaregiverGoogleCalendar);
  const create = useServerFn(createCaregiverGoogleCalendar);
  const sync = useServerFn(syncCaregiverGoogle);
  const disconnect = useServerFn(disconnectCaregiverGoogle);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [name, setName] = useState("Babysitting Schedule");
  const [showCreate, setShowCreate] = useState(false);
  const [createdCalendar, setCreatedCalendar] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState("");
  const status = useQuery({ queryKey: ["caregiver-google", userId], queryFn: () => load(), refetchInterval: 30000 });
  const calendars = useQuery({ queryKey: ["caregiver-google-calendars", userId, status.data?.connection?.status], queryFn: () => list(), enabled: status.data?.connection?.status === "connected" });
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await action(); await queryClient.invalidateQueries({ queryKey: ["caregiver-google", userId] }); await calendars.refetch(); toast.success(message, { duration: 2000 }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Google Calendar action failed"); }
    finally { inFlight.current = false; setBusy(false); }
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
      <div className="flex flex-wrap gap-2">
        <Select disabled={busy} value={selected || connection.calendar_id || ""} onValueChange={setSelected}><SelectTrigger className="w-full sm:w-64"><SelectValue placeholder={connection.calendar_name ?? "Work calendar"} /></SelectTrigger><SelectContent>{(calendars.data ?? []).filter(c => c.accessRole === "writer" || c.accessRole === "owner").map(c => <SelectItem key={c.id} value={c.id}>{c.summary}</SelectItem>)}{createdCalendar && !calendars.data?.some(c => c.id === createdCalendar.id) && <SelectItem value={createdCalendar.id}>{createdCalendar.name}</SelectItem>}</SelectContent></Select>
        <Button disabled={busy || !selected || selected === connection.calendar_id} onClick={() => {
          if (connection.calendar_id && !window.confirm("Move your OFC caregiver shifts to this calendar? Only OFC-owned caregiver events will be removed from the previous calendar.")) return;
          void run(async () => { await choose({ data: { calendarId: selected } }); setSelected(""); await sync().catch(() => undefined); }, "Work calendar selected");
        }}>{connection.calendar_id ? "Change calendar" : "Use calendar"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setShowCreate(v => !v)}><Plus className="size-4" />New Google calendar</Button>
      </div>
      {showCreate && <form className="space-y-2" onSubmit={e => {
        e.preventDefault();
        if (connection.calendar_id && !window.confirm("Create this calendar and move your OFC caregiver shifts to it? Only OFC-owned caregiver events will be removed from the previous calendar.")) return;
        void run(async () => {
          const result = await create({ data: { name } });
          setCreatedCalendar({ id: result.calendarId, name: result.name }); setSelected(result.calendarId); setShowCreate(false);
          if (!result.selected) throw new Error(`Calendar created. Select it from the list to finish: ${result.error ?? "selection pending"}`);
          setSelected(""); await sync().catch(() => undefined);
        }, "Calendar created and selected");
      }}><Label htmlFor="caregiver-google-calendar-name">Calendar name</Label><Input id="caregiver-google-calendar-name" required maxLength={160} value={name} onChange={e => setName(e.target.value)} /><Button type="submit" disabled={busy || !name.trim()}>Create and use calendar</Button></form>}
      {calendars.isError && <p role="alert" className="text-sm text-destructive">Could not load Google calendars. Reconnect if access has expired.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !connection.calendar_id} onClick={() => void run(() => sync(), "Sync checked")}><RefreshCw className="size-4" />Sync now</Button><Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await disconnect(); setSelected(""); setCreatedCalendar(null); }, "Google disconnected")}><Unlink className="size-4" />Disconnect</Button></div>
      <p role="status" className="text-sm text-muted-foreground">{status.isError ? "Sync status unavailable" : status.isFetching ? "Checking sync status…" : status.data?.issues ? `${status.data.issues} shifts need sync attention · use Sync now to retry` : status.data?.moving ? "Moving calendars · previous-calendar cleanup pending" : status.data?.pending ? `${status.data.pending} shifts pending sync` : connection.calendar_id ? "Synced" : "Not syncing yet"}</p>
    </>}
  </section>;
}