import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GoogleAccountSettings, GoogleCalendarDialog, SYNC_KEY } from "@/components/CalendarSyncSettings";
import { getSyncSettings, linkOfcCalendarToGoogle } from "@/lib/google.functions";
import { createOfcCalendar } from "@/lib/ofc-calendars.functions";
import { getShiftSettings, updateShiftSettings } from "@/lib/babysitter-shifts.functions";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import { isWritableDestination, type CalendarSource } from "@/lib/family-data";
import { confirmChildcareSetup, type ChildcareDestination } from "@/lib/childcare-setup";

const NONE = "__none__";
const DESTINATIONS: { value: ChildcareDestination; label: string }[] = [
  { value: "ofc", label: "Create a new OFC calendar (recommended)" },
  { value: "google", label: "Create a new Google Calendar" },
  { value: "existing", label: "Use an existing calendar" },
];

export function ChildcareCalendarSelect({ value, onValueChange, sources, disabled = false }: {
  value: string | null; onValueChange: (value: string | null) => void;
  sources: CalendarSource[]; disabled?: boolean;
}) {
  return <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onValueChange(v === NONE ? null : v)}>
    <SelectTrigger aria-label="Calendar for babysitting shifts" className="h-10 rounded-xl min-w-0 [&>span]:truncate"><SelectValue placeholder="Choose a calendar" /></SelectTrigger>
    <SelectContent><SelectItem value={NONE}>Not set</SelectItem>{sources.filter(isWritableDestination).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.provider === "google" ? "Google" : "OFC"}</SelectItem>)}</SelectContent>
  </Select>;
}

/** Shared draft and confirmation; no calendar is created on expanding or typing. */
export function useChildcareSetup() {
  const { sources } = useCalendar();
  const qc = useQueryClient();
  const create = useServerFn(createOfcCalendar);
  const link = useServerFn(linkOfcCalendarToGoogle);
  const loadGoogle = useServerFn(getSyncSettings);
  const loadShifts = useServerFn(getShiftSettings);
  const select = useServerFn(updateShiftSettings);
  const [destination, setDestination] = useState<ChildcareDestination>("ofc");
  const [name, setName] = useState("Babysitter");
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const inFlight = useRef<Promise<string> | null>(null);
  const google = useQuery({ queryKey: SYNC_KEY, queryFn: () => loadGoogle() });
  const connected = google.data?.connection?.status === "connected";
  const full = (google.data?.calendars.length ?? 0) >= (google.data?.max_calendars ?? 2);
  const ready = destination === "existing" ? sources.some((s) => s.id === calendarId && isWritableDestination(s)) :
    name.trim().length <= 60 && (destination !== "google" || (connected && !full));
  const confirm = () => {
    if (inFlight.current) return inFlight.current;
    const attempt = confirmChildcareSetup({ destination, name, calendarId }, {
      create: async (calendarName) => {
        // Check prerequisites before claiming an OFC source for Google creation.
        if (destination === "google") {
          const current = await loadGoogle();
          if (current.connection?.status !== "connected") throw new Error("Connect a Google account first.");
          if (current.calendars.length >= current.max_calendars) throw new Error("Both Google calendar slots are in use.");
        }
        return create({ data: { name: calendarName, color: "sky", icon: "sitter", display_mode: "events", onboarding_babysitter: true } });
      },
      isGoogle: async (id) => (await loadGoogle()).calendars.some((s) => s.id === id),
      linkGoogle: (id, calendarName) => link({ data: { source_id: id, mode: "create", name: calendarName } }),
      select: async (id) => {
        if (!sources.some((s) => s.id === id && isWritableDestination(s))) throw new Error("Choose an available OFC or Google calendar.");
        const current = await loadShifts();
        return select({ data: { calendar_source_id: id, default_member_id: current.default_member_id } });
      },
    }).finally(() => {
      inFlight.current = null;
      void qc.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
      void qc.invalidateQueries({ queryKey: ["shift-settings"] });
      void qc.invalidateQueries({ queryKey: SYNC_KEY });
    });
    inFlight.current = attempt;
    return attempt;
  };
  return { destination, setDestination, name, setName, calendarId, setCalendarId, sources, connected, full, ready, confirm };
}

export function ChildcareSetupFields({ setup, disabled = false }: { setup: ReturnType<typeof useChildcareSetup>; disabled?: boolean }) {
  const [connectOpen, setConnectOpen] = useState(false);
  return <div className="space-y-3">
    <p className="text-sm font-semibold">Where should babysitting shifts be saved?</p>
    <RadioGroup aria-label="Calendar for babysitting shifts" value={setup.destination} onValueChange={(v) => {
      const choice = DESTINATIONS.find((option) => option.value === v);
      if (choice) setup.setDestination(choice.value);
    }} disabled={disabled}>
      {DESTINATIONS.map((option) => <label key={option.value} className="flex items-start gap-3 text-sm"><RadioGroupItem value={option.value} className="mt-0.5 shrink-0" /><span>{option.label}</span></label>)}
    </RadioGroup>
    {setup.destination === "existing" ? <>
      <ChildcareCalendarSelect sources={setup.sources} value={setup.calendarId} onValueChange={setup.setCalendarId} disabled={disabled} />
      <Button type="button" variant="outline" disabled={disabled} className="h-auto min-h-10 whitespace-normal" onClick={() => setConnectOpen(true)}>Connect an existing Google Calendar</Button>
      <GoogleCalendarDialog open={connectOpen} onOpenChange={setConnectOpen} backgroundSetup />
    </> : <div className="space-y-1.5">
      <Label>Calendar name (optional)</Label>
      <Input aria-label="Childcare calendar name" value={setup.name} maxLength={60} placeholder="Babysitter" disabled={disabled} onChange={(e) => setup.setName(e.target.value)} />
    </div>}
    {setup.destination === "google" && !setup.connected ? <GoogleAccountSettings initiallyExpanded /> : null}
    {setup.destination === "google" && setup.full ? <p className="text-xs text-muted-foreground">Both Google calendar slots are in use. Choose an existing calendar or create an OFC calendar.</p> : null}
    <p className="text-xs text-muted-foreground">Only new shifts use this calendar. Existing events and assignments stay unchanged. Apple / iCloud subscriptions are read-only. No caregiver account or invitation is required.</p>
  </div>;
}