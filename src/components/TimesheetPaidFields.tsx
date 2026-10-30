import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Editor state for "Already paid" — tracked apart from worked hours. */
export type PaidDraft = { on: boolean; hours: string; note: string };

export function usePaidState(entry?: { paid_hours?: number | null; paid_note?: string | null } | null, draft?: PaidDraft) {
  const initOn = entry?.paid_hours != null;
  const initHours = initOn ? String(Number(entry?.paid_hours)) : "";
  const initNote = entry?.paid_note ?? "";
  const [on, setOn] = useState(draft?.on ?? initOn);
  const [hours, setHours] = useState(draft?.hours ?? initHours);
  const [note, setNote] = useState(draft?.note ?? initNote);
  const dirty = on !== initOn || (on && (hours !== initHours || note !== initNote));
  const num = Number(hours);
  const valid = (max: number) => !on || (hours.trim() !== "" && Number.isFinite(num) && num >= 0 && num <= max + 0.005);
  const payload = () => (on ? { paid_hours: Math.round(num * 100) / 100, paid_note: note.trim() || null } : { paid_hours: null, paid_note: null });
  const reset = () => { setOn(initOn); setHours(initHours); setNote(initNote); };
  return { on, setOn, hours, setHours, note, setNote, dirty, valid, payload, reset };
}

export type PaidState = ReturnType<typeof usePaidState>;

export function TimesheetPaidFields({ id, state, maxHours }: { id: string; state: PaidState; maxHours: number }) {
  const max = Math.round(maxHours * 100) / 100;
  const invalid = !state.valid(maxHours);
  return (
    <div className="space-y-2">
      <label htmlFor={`paid-${id}`} className="-my-2 flex min-h-11 cursor-pointer items-center gap-2 py-2 text-xs">
        <Checkbox
          id={`paid-${id}`}
          checked={state.on}
          onCheckedChange={(v) => {
            const on = v === true;
            state.setOn(on);
            if (on && state.hours === "") state.setHours(String(max));
          }}
        />
        Already paid for some or all hours
      </label>
      {state.on ? (
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`paid-h-${id}`} className="block whitespace-nowrap text-xs leading-4">Hours already paid</Label>
            <Input
              id={`paid-h-${id}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={max}
              step="0.25"
              value={state.hours}
              aria-invalid={invalid}
              onChange={(e) => state.setHours(e.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`paid-n-${id}`} className="block whitespace-nowrap text-xs leading-4">Notes (optional)</Label>
            <Input id={`paid-n-${id}`} placeholder="Paid via Venmo" value={state.note} maxLength={300} onChange={(e) => state.setNote(e.target.value)} />
          </div>
          {invalid ? <p className="col-span-2 text-xs text-destructive">Enter 0 to {max} hours.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Summary lines shown only when any paid hours exist. */
export function PaidSummary({ entries, total, className }: { entries: { paid_hours?: number | null }[]; total: number; className?: string }) {
  const paid = entries.reduce((n, e) => n + (e.paid_hours != null ? Number(e.paid_hours) : 0), 0);
  if (!entries.some((e) => e.paid_hours != null)) return null;
  const fmt = (h: number) => `${Math.round(h * 100) / 100} h`;
  return (
    <div className={className ?? "text-xs text-muted-foreground"}>
      <p>Already paid · {fmt(paid)}</p>
      <p>Remaining unpaid hours · {fmt(Math.max(0, total - paid))}</p>
    </div>
  );
}
