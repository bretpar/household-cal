import { addDays, startOfDay } from "date-fns";
import { seriesOccursOnKey } from "./family-data";
import { workDate, workDateInput, workInputInstant, workInputInstants } from "./caregiver-timezone";

/** Persist only requested windows; scheduled Google delivery advances a 90-day horizon. */
export async function ensureCaregiverOccurrences(userId: string, from: string, to: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const [workspace, series] = await Promise.all([
    db.from("caregiver_workspaces").select("timezone").eq("user_id", userId).single(),
    db.from("caregiver_shift_series").select("*").eq("user_id", userId).lt("start_at", to),
  ]);
  if (workspace.error || series.error || !workspace.data) throw new Error("Could not load recurring shifts");
  const zone = workspace.data.timezone;
  for (const s of series.data ?? []) {
    const base = workDate(s.start_at, zone);
    const startKey = workDateInput(base).slice(0, 10);
    const rule = { recurrence_rule: `FREQ=WEEKLY;BYDAY=${s.weekdays.join(",")}`, recurrence_until: s.until_date, excluded_dates: [] };
    const rows: { date: string; start_at: string; end_at: string }[] = [];
    // Include continuations of multi-day shifts overlapping this window.
    const duration = Date.parse(s.end_at) - Date.parse(s.start_at);
    for (let day = addDays(startOfDay(workDate(from, zone)), -Math.ceil(duration / 86400000)); day.getTime() < Date.parse(to); day = addDays(day, 1)) {
      const key = workDateInput(day).slice(0, 10);
      if (!seriesOccursOnKey(rule, startKey, key)) continue;
      const wall = `${key}T${workDateInput(base).slice(11)}`;
      const choices = workInputInstants(wall, zone);
      // Nonexistent wall times are omitted; folds consistently use the base occurrence preference.
      if (!choices.length) continue;
      const baseChoices = workInputInstants(workDateInput(base), zone);
      const selected = choices[baseChoices.indexOf(new Date(s.start_at).toISOString()) === 1 ? choices.length - 1 : 0];
      const start_at = workInputInstant(wall, zone, undefined, selected);
      rows.push({ date: key, start_at, end_at: new Date(Date.parse(start_at) + duration).toISOString() });
    }
    if (rows.length) {
      const { error } = await db.rpc("materialize_caregiver_occurrences", { _user: userId, _series: s.id, _version: s.version, _rows: rows });
      if (error) throw new Error(error.message);
    }
  }
}