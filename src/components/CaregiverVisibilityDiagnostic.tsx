import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCalendar } from "@/lib/calendar-store";
import { listDiagnosticCaregivers, runCaregiverDiagnostic } from "@/lib/caregiver-diagnostic.functions";

/** Temporary, read-only owner diagnostic. Rendered only inside unlocked Maintenance. */
export function CaregiverVisibilityDiagnostic() {
  const { family, isOwner } = useCalendar();
  const list = useServerFn(listDiagnosticCaregivers);
  const run = useServerFn(runCaregiverDiagnostic);
  const [who, setWho] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const cg = useQuery({
    queryKey: ["diag-caregivers", family?.id],
    enabled: !!family?.id && isOwner,
    queryFn: () => list({ data: { family_id: family!.id } }),
  });
  const m = useMutation({ mutationFn: () => run({ data: { membership_id: who, date } }) });
  if (!isOwner) return null;
  const r = m.data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Caregiver visibility diagnostic</h2>
      <div className="space-y-2 rounded-3xl border border-dashed border-border bg-card p-4 text-sm">
        <select className="h-10 w-full rounded-md border border-input bg-background px-2" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose caregiver…</option>
          {(cg.data ?? []).map((c) => <option key={c.membership_id} value={c.membership_id}>{c.name}</option>)}
        </select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button size="sm" disabled={!who || !date || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Running…" : "Run diagnostic"}
        </Button>
        {m.isError ? <p className="text-destructive">{m.error instanceof Error ? m.error.message : "Failed"}</p> : null}
        {r ? (
          <div className="space-y-3 pt-2 font-mono text-xs break-words">
            <div>
              <p className="font-sans font-bold">Access summary</p>
              <p>{r.name} · {r.scope} · authorized shift day: {r.authorized ? "Yes" : "No"}</p>
              {r.load_error ? <p className="text-destructive">secure load error: {r.load_error}</p> : null}
              {r.calendars.map((c) => <p key={c.id}>• {c.name} · {c.id}{c.external_id ? ` · ${c.external_id}` : ""}</p>)}
            </div>
            <div className="space-y-2">
              <p className="font-sans font-bold">Events ({r.events.length})</p>
              {r.events.map((e) => (
                <div key={e.id} className="rounded-xl border border-border-soft p-2">
                  <p className="font-sans font-semibold">{e.title}</p>
                  <p>{e.id}</p>
                  <p>{e.calendar} · {e.calendar_source_id}</p>
                  <p>{e.kind}{e.recurrence_rule ? ` · ${e.recurrence_rule}` : ""}</p>
                  {e.assignment ? <p>shift: {e.assignment}</p> : null}
                  <p className={e.decision.startsWith("INCLUDED") ? "text-foreground" : "text-destructive"}>{e.decision}</p>
                  {e.client_note ? <p className="text-muted-foreground">client: {e.client_note}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
