import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALENDAR_COLORS, CALENDAR_ICON_KEYS, CALENDAR_ICON_LABELS, CALENDAR_ICON_NONE } from "@/lib/calendar-appearance";
import { FAMILY_BUNDLE_KEY, useCalendar } from "@/lib/calendar-store";
import { styleForColor } from "@/lib/family-data";
import { importCalendarFileBatch, previewCalendarFile } from "@/lib/ics-file-import.functions";
import { createOfcCalendar } from "@/lib/ofc-calendars.functions";
import { cn } from "@/lib/utils";

type Preview = Awaited<ReturnType<typeof previewCalendarFile>>;
const NEW = "__new__";

export function ImportCalendarFileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { sources } = useCalendar();
  const preview = useServerFn(previewCalendarFile);
  const importBatch = useServerFn(importCalendarFileBatch);
  const createCalendar = useServerFn(createOfcCalendar);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [destination, setDestination] = useState<string>(NEW);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CALENDAR_COLORS[0] as string);
  const [icon, setIcon] = useState<string>(CALENDAR_ICON_NONE);
  const [info, setInfo] = useState<Preview | null>(null);
  const [googleOk, setGoogleOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, created: 0, skipped: 0 });
  const [result, setResult] = useState<string | null>(null);

  const destinations = sources.filter(
    (s) =>
      s.active &&
      ((s.calendar_kind === "custom" && (s.provider === "local" || s.provider === "google")) ||
        (s.calendar_kind === "household_default" && s.provider === "local")),
  );

  const reset = () => {
    setStep(1); setText(""); setFileName(""); setDestination(NEW); setName(""); setInfo(null);
    setGoogleOk(false); setProgress({ done: 0, total: 0, created: 0, skipped: 0 }); setResult(null);
  };
  const close = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const loadPreview = async (fileText: string, dest: string) => {
    setBusy(true);
    try {
      const data = await preview({ data: { text: fileText, source_id: dest === NEW ? null : dest } });
      setInfo(data);
      setGoogleOk(false);
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.ics$/i.test(file.name) && file.type !== "text/calendar") {
      toast.error("Choose a calendar file ending in .ics");
      return;
    }
    if (file.size > 2_000_000) {
      toast.error("That file is too large (2 MB maximum)");
      return;
    }
    const content = await file.text();
    setText(content);
    setFileName(file.name);
    if (!name) setName(file.name.replace(/\.ics$/i, "").slice(0, 60));
    await loadPreview(content, destination);
  };

  const runImport = async () => {
    setBusy(true);
    setStep(3);
    let sourceId = destination;
    let created = 0;
    let skipped = 0;
    let offset = 0;
    try {
      if (destination === NEW) {
        const row = await createCalendar({
          data: { name, color, icon: icon === CALENDAR_ICON_NONE ? null : icon, display_mode: "events" },
        });
        sourceId = row.id;
        setDestination(row.id); // a retry imports into this calendar, not a second new one
      }
      for (;;) {
        const r = await importBatch({ data: { text, source_id: sourceId, offset, google_confirmed: googleOk } });
        created += r.created;
        skipped += r.skipped;
        offset = r.next;
        setProgress({ done: offset, total: r.total, created, skipped });
        if (r.done) break;
      }
      setResult(`Imported ${created} event${created === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} already in the calendar` : ""}.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Import stopped";
      setResult(`Import stopped: ${msg}. ${created} event${created === 1 ? " was" : "s were"} imported before it stopped. Importing the same file again skips those, so nothing is duplicated.`);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: FAMILY_BUNDLE_KEY });
    }
  };

  const destName = destination === NEW ? name : destinations.find((s) => s.id === destination)?.name;
  const canImport =
    !!info && !busy && (destination !== NEW ? true : !!name.trim()) && (!info.googleBound || googleOk) &&
    info.total > info.duplicates;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import calendar file · Step {step} of 3</DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Choose an .ics file exported from Google, Apple, Outlook or another calendar. Events are copied once and become editable here.
            </p>
            <Input type="file" accept=".ics,text/calendar" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} className="h-11" />
            {busy ? <p className="text-sm text-muted-foreground">Reading file…</p> : null}
          </div>
        ) : null}

        {step === 2 && info ? (
          <div className="space-y-3 text-sm">
            <p className="break-all text-muted-foreground">{fileName}</p>
            <div className="space-y-1.5">
              <label className="font-medium">Import into</label>
              <Select value={destination} onValueChange={(v) => { setDestination(v); void loadPreview(text, v); }} disabled={busy}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>New calendar…</SelectItem>
                  {destinations.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.provider === "google" ? " (linked to Google)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {destination === NEW ? (
              <div className="space-y-2">
                <Input value={name} maxLength={60} placeholder="Calendar name" aria-label="New calendar name" onChange={(e) => setName(e.target.value)} className="h-11" />
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
                  {CALENDAR_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} aria-checked={color === c} role="radio" onClick={() => setColor(c)}
                      className={cn("h-8 w-8 rounded-full border", styleForColor(c).dot, color === c && "ring-2 ring-ring ring-offset-2")}
                      />
                  ))}
                </div>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger className="h-11" aria-label="Icon"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CALENDAR_ICON_NONE}>No icon</SelectItem>
                    {CALENDAR_ICON_KEYS.map((k) => (<SelectItem key={k} value={k}>{CALENDAR_ICON_LABELS[k]}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <ul className="space-y-0.5 rounded-md border p-3">
              <li><strong>{info.total}</strong> events found ({info.recurring} repeating, {info.allDay} all-day)</li>
              {info.duplicates ? <li><strong>{info.duplicates}</strong> already in this calendar — will be skipped</li> : null}
              {info.cancelled ? <li>{info.cancelled} cancelled events will be skipped</li> : null}
              <li>Will import <strong>{info.total - info.duplicates}</strong>. Existing events aren't changed.</li>
            </ul>
            {info.unsupported.length ? (
              <div className="rounded-md bg-muted p-3">
                <p className="font-medium">Not imported from this file:</p>
                <ul className="list-disc pl-5">{info.unsupported.map((u) => <li key={u}>{u}</li>)}</ul>
              </div>
            ) : null}
            {info.googleBound ? (
              <label className="flex items-start gap-2 rounded-md border border-destructive/40 p-3">
                <Checkbox checked={googleOk} onCheckedChange={(v) => setGoogleOk(v === true)} className="mt-0.5" />
                <span>This calendar sends events to Google. Imported events may be copied to its Google calendar. I understand.</span>
              </label>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-2 text-sm">
            <p>Importing into {destName}…</p>
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%` }} />
            </div>
            <p className="text-muted-foreground">{progress.done} of {progress.total || "…"} processed</p>
            {result ? <p className="font-medium">{result}</p> : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {step === 2 ? (
            <>
              <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancel</Button>
              <Button onClick={runImport} disabled={!canImport}>Import</Button>
            </>
          ) : step === 3 ? (
            <Button onClick={() => close(false)} disabled={busy}>Done</Button>
          ) : (
            <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancel</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
