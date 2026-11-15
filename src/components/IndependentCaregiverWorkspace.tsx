import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Home, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthView } from "@/components/MonthView";
import { WeekView } from "@/components/WeekView";
import { EventCard } from "@/components/EventCard";
import { AccountDeletion } from "@/components/AccountDeletion";
import { SignOutButton } from "@/components/SignOutButton";
import { CaregiverGoogleSettings } from "./CaregiverGoogleSettings";
import { CaregiverCalendarStore } from "@/lib/caregiver-calendar-store";
import { getCaregiverWorkTimezone, getCaregiverWorkspace, saveCaregiverShift, deleteCaregiverShift, saveCaregiverClient, archiveCaregiverClient } from "@/lib/independent-caregiver.functions";
import { scheduledHours, workEvents, type CaregiverClient, type WorkShift } from "@/lib/independent-caregiver";
import { MEMBER_COLORS, expandOccurrences, styleForColor } from "@/lib/family-data";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { workDate, workInput, workInputInstant, workInputInstants, workDateInput, workOffset } from "@/lib/caregiver-timezone";

const NAV = [
  { to: "/caregiver/today", label: "Today", icon: Home },
  { to: "/caregiver/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/caregiver/timesheets", label: "Timesheets", icon: ClipboardList },
  { to: "/caregiver/settings", label: "Settings", icon: Settings },
] as const;
export type CaregiverTab = "today" | "calendar" | "timesheets" | "settings";
type ShiftForm = { original: WorkShift | null; client_id: string; start: string; end: string; notes: string; startOccurrence?: string; endOccurrence?: string };


export function IndependentCaregiverWorkspace({ tab }: { tab: CaregiverTab }) {
  const load = useServerFn(getCaregiverWorkspace);
  const loadTimezone = useServerFn(getCaregiverWorkTimezone);
  const saveShift = useServerFn(saveCaregiverShift);
  const removeShift = useServerFn(deleteCaregiverShift);
  const saveClient = useServerFn(saveCaregiverClient);
  const archiveClient = useServerFn(archiveCaregiverClient);
  const [selectedAnchor, setAnchor] = useState<Date | null>(null);
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [shiftForm, setShiftForm] = useState<ShiftForm | null>(null);
  const [clientForm, setClientForm] = useState<{ id?: string; name: string; email: string; color: CaregiverClient["color"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const submission = useRef(false);
  const identity = useQuery({ queryKey: ["caregiver-verified-user"], queryFn: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new Error("Sign in to view your work calendar");
    return data.user.id;
  } });
  const zone = useQuery({ queryKey: ["caregiver-zone", identity.data], queryFn: () => loadTimezone(), enabled: Boolean(identity.data) });
  useEffect(() => { if (zone.data) setAnchor(current => current ? workDate(current, zone.data) : workDate(Date.now(), zone.data)); }, [zone.data]);
  const timezone = zone.data;
  const anchor = selectedAnchor ?? new Date(0);
  const rangeAnchor = tab === "today" && timezone ? workDate(Date.now(), timezone) : anchor;
  const from = startOfWeek(startOfMonth(rangeAnchor));
  const to = tab === "today" ? addDays(startOfDay(rangeAnchor), 60) : addDays(endOfWeek(endOfMonth(rangeAnchor)), 1);
  const workspace = useQuery({ queryKey: ["caregiver-work", identity.data, from.toISOString(), to.toISOString()],
    queryFn: () => load({ data: { from: from.toISOString(), to: to.toISOString() } }), enabled: Boolean(identity.data && timezone && selectedAnchor) });
  const clients = (workspace.data?.clients ?? []) as CaregiverClient[];
  const shifts = workspace.data?.shifts ?? [];
  const activeClients = clients.filter(c => !c.archived);
  const openShift = (shift: WorkShift) => { if (!timezone) return; setShiftForm({ original: shift, client_id: shift.client_id,
    start: workInput(shift.start_at, timezone), end: workInput(shift.end_at, timezone), notes: shift.notes ?? "" }); };
  const newShift = (start?: Date, end?: Date) => {
    if (!timezone) return;
    const a = workDate(start ?? Date.now(), timezone);
    if (!end) a.setHours(9, 0, 0, 0);
    setShiftForm({ original: null, client_id: activeClients[0]?.id ?? "", start: workDateInput(a),
      end: workDateInput(workDate(end ?? a.getTime() + 4 * 3600000, timezone)), notes: "" });
  };
  const run = async (action: () => Promise<unknown>, message: string, close?: () => void) => {
    if (submission.current) return;
    submission.current = true; setBusy(true);
    try {
      await action(); close?.(); toast.success(message, { duration: 2000 });
      try { await workspace.refetch({ throwOnError: true }); }
      catch { toast.error("Saved, but the calendar could not refresh. Reload before making another edit."); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save your changes"); }
    finally { submission.current = false; setBusy(false); }
  };
  const events = workEvents(shifts, clients, timezone);
  const today = startOfDay(timezone ? workDate(Date.now(), timezone) : new Date(0));
  const monthStart = startOfMonth(anchor), monthEnd = addMonths(monthStart, 1);
  const total = scheduledHours(shifts, monthStart, monthEnd);
  const upcoming = expandOccurrences(events, today, to).filter(o => o.end > new Date());
  const formatHours = (hours: number) => `${Number(hours.toFixed(2))} hours`;
  const repeatedTimeControl = (field: "start" | "end") => {
    if (!shiftForm || !timezone) return null;
    const candidates = workInputInstants(shiftForm[field], timezone);
    if (candidates.length < 2) return null;
    const selection = field === "start" ? shiftForm.startOccurrence : shiftForm.endOccurrence;
    const original = field === "start" ? shiftForm.original?.start_at : shiftForm.original?.end_at;
    const preserved = original && workInput(original, timezone) === shiftForm[field]
      ? candidates.find(candidate => Date.parse(candidate) === Math.floor(Date.parse(original) / 60000) * 60000)
      : undefined;
    return <Select value={selection ?? preserved ?? ""} onValueChange={occurrence => setShiftForm({ ...shiftForm, [field === "start" ? "startOccurrence" : "endOccurrence"]: occurrence })}>
      <SelectTrigger aria-label={`${field === "start" ? "Start" : "End"} repeated time occurrence`}><SelectValue placeholder="Choose repeated time occurrence" /></SelectTrigger>
      <SelectContent>{candidates.map((candidate, index) => <SelectItem key={candidate} value={candidate}>{index === 0 ? "First" : "Second"} occurrence · UTC{workOffset(candidate, timezone)}</SelectItem>)}</SelectContent>
    </Select>;
  };
  return <div className="app-shell min-h-dvh bg-background">
    <header className="app-shell-header sticky top-0 z-30 border-b border-border-soft bg-surface">
      <div className="app-shell-header-inner mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/caregiver/today" className="flex min-w-0 items-center gap-2"><img src={logo.url} alt="" className="size-8" /><span className="truncate font-display text-lg font-bold">Our Family Calendar</span></Link>
        <nav aria-label="Work navigation" className="hidden gap-1 md:flex">{NAV.map(n => <Button key={n.to} variant={tab === n.to.split("/").at(-1) ? "secondary" : "ghost"} asChild><Link to={n.to}><n.icon className="size-4" />{n.label}</Link></Button>)}</nav>
      </div>
    </header>
    <main className="app-shell-main mx-auto max-w-6xl space-y-5 px-3 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl font-bold">{tab === "today" ? "My work today" : tab === "calendar" ? "My work calendar" : tab === "timesheets" ? "Scheduled hours" : "My settings"}</h1>
        {tab !== "settings" && <Button disabled={busy || !workspace.data} onClick={() => newShift()}><Plus className="size-4" />Add shift</Button>}
      </div>
      {identity.isError || workspace.isError || zone.isError ? <div role="alert" className="space-y-3"><p className="text-destructive">Could not load your private work calendar.</p><Button variant="outline" onClick={() => { void identity.refetch(); void zone.refetch(); void workspace.refetch(); }}>Try again</Button></div> : !workspace.data || !identity.data || !timezone ? <p className="text-muted-foreground">Loading your work calendar…</p> : <CaregiverCalendarStore clients={clients} shifts={shifts} timezone={timezone} openShift={openShift}
        moveShift={async (shift, draft) => {
          await saveShift({ data: { id: shift.id, version: shift.version, client_id: shift.client_id, start_at: draft.start_at, end_at: draft.end_at, notes: shift.notes } });
          await workspace.refetch();
        }}>
        {tab === "today" && <>
          <p className="text-muted-foreground">{format(today, "EEEE, MMMM d")} · {formatHours(scheduledHours(shifts, today, addDays(today, 1)))} scheduled today</p>
          <h2 className="text-lg font-bold">Upcoming shifts</h2>
          <div className="grid gap-3 sm:grid-cols-2">{upcoming.slice(0, 12).map(o => <EventCard key={o.key} occurrence={o} showDate={format(o.start, "EEE, MMM d")} />)}</div>
          {!upcoming.length && <p className="text-muted-foreground">No upcoming shifts this month.</p>}
        </>}
        {(tab === "calendar" || tab === "timesheets") && <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => setAnchor(addMonths(anchor, -1))}><ChevronLeft className="size-4" /></Button><h2 className="text-lg font-bold">{format(anchor, "MMMM yyyy")}</h2><Button size="icon" variant="ghost" aria-label="Next month" onClick={() => setAnchor(addMonths(anchor, 1))}><ChevronRight className="size-4" /></Button><Button variant="outline" size="sm" onClick={() => timezone && setAnchor(workDate(Date.now(), timezone))}>Today</Button></div>
          {tab === "calendar" && <div role="group" aria-label="Calendar view" className="flex gap-1">{(["month", "week", "day"] as const).map(v => <Button key={v} variant={view === v ? "secondary" : "ghost"} size="sm" onClick={() => setView(v)}>{v[0]?.toUpperCase()}{v.slice(1)}</Button>)}</div>}
        </div>}
        {tab === "calendar" && <>
          <div className="flex flex-wrap gap-3">{activeClients.map(c => <span key={c.id} className="flex items-center gap-1.5 text-xs"><span className={cn("size-2 rounded-full", styleForColor(c.color).dot)} />{c.name}</span>)}</div>
          {view === "month" ? <MonthView month={anchor} events={events} selectedMembers={[]} onSelectDay={day => { setAnchor(day); setView("day"); }} onCreateAt={day => newShift(day)} /> : <WeekView anchor={view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor} events={events} selectedMembers={[]} days={view === "day" ? 1 : 7} onCreateRange={(start, end) => newShift(start, end)} />}
          <div className="grid gap-2 sm:grid-cols-2">{expandOccurrences(events, startOfDay(anchor), addDays(startOfDay(anchor), 1)).map(o => <EventCard key={o.key} occurrence={o} />)}</div>
        </>}
        {tab === "timesheets" && <section className="space-y-3">
          <p className="text-2xl font-bold">{formatHours(total)} scheduled</p>
          {clients.map(c => <div key={c.id} className="flex justify-between border-b border-border-soft py-2"><span>{c.name}</span><span>{formatHours(scheduledHours(shifts.filter(s => s.client_id === c.id), monthStart, monthEnd))}</span></div>)}
          <p className="text-sm text-muted-foreground">Actual hours and approvals are not recorded here.</p>
        </section>}
        {tab === "settings" && <div className="max-w-2xl space-y-6">
          <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Family contacts</h2><Button size="sm" onClick={() => setClientForm({ name: "", email: "", color: MEMBER_COLORS[clients.length % MEMBER_COLORS.length] ?? "sky" })}><Plus className="size-4" />Add family</Button></div>
            {clients.map(c => <div key={c.id} className="flex items-center justify-between gap-2 border-b border-border-soft py-3"><div className="min-w-0"><p className="flex items-center gap-2 font-semibold"><span className={cn("size-2 shrink-0 rounded-full", styleForColor(c.color).dot)} />{c.name}{c.archived ? " · Archived" : ""}</p><p className="truncate text-sm text-muted-foreground">{c.email}</p></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setClientForm({ id: c.id, name: c.name, email: c.email ?? "", color: c.color })}><Pencil className="size-4" /></Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => archiveClient({ data: { id: c.id, archived: !c.archived } }), c.archived ? "Family restored" : "Family archived")}>{c.archived ? "Restore" : "Archive"}</Button></div></div>)}
          </section>
          <CaregiverGoogleSettings userId={identity.data} />
          <section className="space-y-3 border-t border-border-soft pt-5"><h2 className="text-lg font-bold">Account</h2><p className="text-sm text-muted-foreground">Work time zone: {workspace.data.workspace.timezone}</p><SignOutButton /><AccountDeletion /></section>
        </div>}
      </CaregiverCalendarStore>}
    </main>
    <nav aria-label="Work navigation" className="app-shell-bottom-nav fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-30 mx-auto grid max-w-lg grid-cols-4 rounded-3xl border border-border-soft bg-surface p-1.5 shadow-lifted md:hidden">{NAV.map(n => <Button key={n.to} variant={tab === n.to.split("/").at(-1) ? "secondary" : "ghost"} className="h-14 min-w-0 flex-col gap-1 px-1 text-[11px]" asChild><Link to={n.to}><n.icon className="size-5" />{n.label}</Link></Button>)}</nav>
    <Dialog open={Boolean(shiftForm)} onOpenChange={open => { if (!open && !busy) setShiftForm(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>{shiftForm?.original ? "Edit work shift" : "New work shift"}</DialogTitle><DialogDescription>{shiftForm?.original ? "Update this family’s scheduled shift." : "Schedule work for one family."}</DialogDescription></DialogHeader>
      {shiftForm && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(() => {
        if (!timezone) throw new Error("Your work time zone is not available.");
        const start_at = workInputInstant(shiftForm.start, timezone, shiftForm.original?.start_at, shiftForm.startOccurrence);
        const end_at = workInputInstant(shiftForm.end, timezone, shiftForm.original?.end_at, shiftForm.endOccurrence);
        if (Date.parse(end_at) <= Date.parse(start_at)) throw new Error("End must be after start. Check the repeated time occurrences.");
        return saveShift({ data: { ...(shiftForm.original ? { id: shiftForm.original.id, version: shiftForm.original.version } : {}), client_id: shiftForm.client_id, start_at, end_at, notes: shiftForm.notes } });
      }, "Shift saved", () => setShiftForm(null)); }}>
        <div className="space-y-1"><Label>Family</Label><Select value={shiftForm.client_id} onValueChange={client_id => setShiftForm({ ...shiftForm, client_id })}><SelectTrigger><SelectValue placeholder="Choose family" /></SelectTrigger><SelectContent>{clients.filter(c => !c.archived || c.id === shiftForm.original?.client_id).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
        {!activeClients.length && <p className="text-sm text-muted-foreground">Add an active family contact in Settings before scheduling.</p>}
        <div className="space-y-1"><Label htmlFor="work-start">Start</Label><Input id="work-start" required type="datetime-local" value={shiftForm.start} onChange={e => setShiftForm({ ...shiftForm, start: e.target.value, startOccurrence: undefined })} />{repeatedTimeControl("start")}</div>
        <div className="space-y-1"><Label htmlFor="work-end">End</Label><Input id="work-end" required type="datetime-local" value={shiftForm.end} onChange={e => setShiftForm({ ...shiftForm, end: e.target.value, endOccurrence: undefined })} />{repeatedTimeControl("end")}</div>
        <div className="space-y-1"><Label htmlFor="work-notes">Notes</Label><Textarea id="work-notes" value={shiftForm.notes} onChange={e => setShiftForm({ ...shiftForm, notes: e.target.value })} /></div>
        <div className="flex flex-wrap justify-between gap-2">{shiftForm.original ? <Button variant="ghost" type="button" disabled={busy} className="text-destructive" onClick={() => {
          const original = shiftForm.original;
          if (original && window.confirm("Delete this work shift?")) void run(() => removeShift({ data: { id: original.id, version: original.version } }), "Shift deleted", () => setShiftForm(null));
        }}><Trash2 className="size-4" />Delete shift</Button> : <span />}<Button disabled={busy || !shiftForm.client_id} type="submit">{busy ? "Saving…" : "Save shift"}</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={Boolean(clientForm)} onOpenChange={open => { if (!open && !busy) setClientForm(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{clientForm?.id ? "Edit family contact" : "Add family contact"}</DialogTitle><DialogDescription>Private to your caregiver account.</DialogDescription></DialogHeader>
      {clientForm && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(() => saveClient({ data: clientForm }), "Family saved", () => setClientForm(null)); }}>
        <div className="space-y-1"><Label htmlFor="client-name">Family name</Label><Input id="client-name" required maxLength={160} value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="client-email">Contact email (optional)</Label><Input id="client-email" type="email" value={clientForm.email} onChange={e => setClientForm({ ...clientForm, email: e.target.value })} /></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Calendar color</legend><div className="flex flex-wrap gap-2">{MEMBER_COLORS.map(color => <Button key={color} type="button" size="icon" variant="outline" aria-label={color} aria-pressed={clientForm.color === color} onClick={() => setClientForm({ ...clientForm, color })} className={cn("size-8 rounded-full", clientForm.color === color && "ring-2 ring-ring")}><span className={cn("size-5 rounded-full", styleForColor(color).dot)} /></Button>)}</div></fieldset>
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Saving…" : "Save family"}</Button>
      </form>}
    </DialogContent></Dialog>
  </div>;
}