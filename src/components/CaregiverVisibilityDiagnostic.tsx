import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCalendar } from "@/lib/calendar-store";
import { auditCaregiverShiftLinkage, listDiagnosticCaregivers, runCaregiverDiagnostic } from "@/lib/caregiver-diagnostic.functions";

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
  const audit = useServerFn(auditCaregiverShiftLinkage);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  const a = useMutation({ mutationFn: () => audit({ data: { membership_id: who, from, to } }) });
  const [copied, setCopied] = useState(false);
  const copyAudit = async (full: boolean) => {
    const d = a.data;
    if (!d) return;
    const name = (cg.data ?? []).find((c: { membership_id: string }) => c.membership_id === who)?.name ?? who;
    const rows = full ? d.rows : d.rows.filter((r) => r.status !== "OK");
    const lines = [
      `Caregiver: ${name}`, `Date range: ${from} – ${to}`, "", "SUMMARY",
      `- Total shifts: ${d.summary.total}`, `- OK: ${d.summary.ok}`, `- Problematic: ${d.summary.problematic}`,
      `- Missing family_user_id: ${d.summary.null_fu}`, `- Stale/mismatched family_user_id: ${d.summary.stale_fu}`,
      `- Shift access NO: ${d.rows.filter((r) => !r.shift_ok).length}`, "", full ? "ALL SHIFTS" : "PROBLEM SHIFTS",
    ];
    if (!rows.length) lines.push(full ? "No shifts found in this range." : "No problematic shifts found in this range.");
    for (const r of rows) lines.push("",
      `${r.title}`, `- Event id: ${r.event_id}${r.recurring ? " (recurring)" : ""}`, `- Date/time: ${r.start_at} → ${r.end_at}`,
      `- assignee_member_id: ${r.assignee_member_id ?? "NULL"}`, `- family_user_id: ${r.family_user_id ?? "NULL"}`,
      `- Caregiver membership id: ${d.identity.membership_id}`,
      `- Event SELECT RLS: ${r.event_ok ? "YES" : "NO"} — ${r.event_rls}`, `- Shift SELECT RLS: ${r.shift_ok ? "YES" : "NO"} — ${r.shift_rls}`,
      `- Status: ${r.status}`);
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  if (!isOwner) return null;
  const r = m.data;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">Caregiver visibility diagnostic</h2>
      <div className="space-y-2 rounded-3xl border border-dashed border-border bg-card p-4 text-sm">
        <select className="h-10 w-full rounded-md border border-input bg-background px-2" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose caregiver…</option>
          {(cg.data ?? []).map((c: { membership_id: string; name: string }) => <option key={c.membership_id} value={c.membership_id}>{c.name}</option>)}
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
              <p>member: {r.identity.family_member_id ?? "NULL"}</p>
              <p>membership: {r.identity.membership_id} · role {r.identity.role}</p>
              <p>auth user: {r.identity.user_id}</p>
              <p>access profile family_user_id: {r.identity.profile_family_user_id}</p>
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
                  <p>{e.detail.start_at} → {e.detail.end_at}</p>
                  <p>type {e.detail.event_type} · display {e.detail.display_mode ?? "?"}</p>
                  {e.detail.shift ? (
                    <p>shift row: {e.detail.shift.assignment} · member {e.detail.shift.assignee_member_id ?? "NULL"} · fu {e.detail.shift.family_user_id ?? "NULL"} · name {e.detail.shift.assignee_name ?? "NULL"}</p>
                  ) : <p>shift row: none</p>}
                  <p>event_members: {e.detail.event_members.length ? e.detail.event_members.join(", ") : "none"}</p>
                  <p className={e.decision.startsWith("INCLUDED") ? "text-foreground" : "text-destructive"}>{e.decision}</p>
                  <p>Event SELECT RLS: {e.detail.event_rls}</p>
                  <p>Shift SELECT RLS: {e.detail.shift_rls}</p>
                  {e.detail.flags.map((f) => <p key={f} className="text-destructive">⚠ {f}</p>)}
                  {e.client_note ? <p className="text-muted-foreground">client: {e.client_note}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 rounded-3xl border border-dashed border-border bg-card p-4 text-sm">
        <p className="font-bold">Caregiver shift linkage audit</p>
        <p className="text-xs text-muted-foreground">Uses the caregiver chosen above. Read-only.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button size="sm" disabled={!who || !from || !to || a.isPending} onClick={() => a.mutate()}>
          {a.isPending ? "Auditing…" : "Run audit"}
        </Button>
        {a.isError ? <p className="text-destructive">{a.error instanceof Error ? a.error.message : "Failed"}</p> : null}
        {a.data ? (
          <div className="space-y-2 pt-2 font-mono text-xs break-words">
            <div className="flex flex-wrap items-center gap-2 font-sans">
              <Button size="sm" variant="outline" onClick={() => void copyAudit(false)}>Copy audit summary</Button>
              <Button size="sm" variant="ghost" onClick={() => void copyAudit(true)}>Copy full audit</Button>
              {copied ? <span className="text-xs text-muted-foreground">Audit copied</span> : null}
            </div>
            <p>member {a.data.identity.family_member_id ?? "NULL"} · membership {a.data.identity.membership_id}</p>
            <p className="font-sans font-semibold">
              Total {a.data.summary.total} · OK {a.data.summary.ok} · Problematic {a.data.summary.problematic} · NULL fu {a.data.summary.null_fu} · Stale fu {a.data.summary.stale_fu}
            </p>
            {a.data.rows.map((r) => (
              <div key={r.event_id} className="rounded-xl border border-border-soft p-2">
                <p className={r.status === "OK" ? "font-sans font-semibold" : "font-sans font-semibold text-destructive"}>{r.status} · {r.title}</p>
                <p>{r.event_id}{r.recurring ? " · recurring" : ""}</p>
                <p>{r.start_at} → {r.end_at}</p>
                <p>assignee_member_id {r.assignee_member_id ?? "NULL"} · family_user_id {r.family_user_id ?? "NULL"}</p>
                <p>Event SELECT RLS: {r.event_ok ? "YES" : "NO"} — {r.event_rls}</p>
                <p>Shift SELECT RLS: {r.shift_ok ? "YES" : "NO"} — {r.shift_rls}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
