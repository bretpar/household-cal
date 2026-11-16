import { formatInTimeZone } from "date-fns-tz";
import { formatHoursValue, timesheetTotals, type TimesheetRow } from "./caregiver-timesheet";

export interface TimesheetDoc { caregiverName: string; familyName: string; from: Date; to: Date; timezone: string; rows: TimesheetRow[] }
const t = (iso: string, tz: string) => formatInTimeZone(iso, tz, "h:mm a");
export const rangeLabel = (d: TimesheetDoc) => `${formatInTimeZone(d.from, d.timezone, "MMM d")} – ${formatInTimeZone(d.to.getTime() - 1, d.timezone, "MMM d, yyyy")}`;
export const pdfFileName = (d: TimesheetDoc) => `Timesheet ${d.familyName} ${formatInTimeZone(d.from, d.timezone, "yyyy-MM-dd")}.pdf`.replace(/[^\w .-]+/g, "");

/** The same effective schedule/adjustment hours as the screen. */
export function timesheetSummary(d: TimesheetDoc) {
  const totals = timesheetTotals(d.rows);
  const lines = d.rows.map(r => `${r.workDate}: ${t(r.actualStart, d.timezone)} – ${t(r.actualEnd, d.timezone)} (${formatHoursValue(r.actualHours)} h, ${r.confirmed ? "Adjusted actual" : "Scheduled"})${r.note ? ` · ${r.note}` : ""}`);
  return [`Timesheet for ${d.familyName}`, `Caregiver: ${d.caregiverName}`, `Period: ${rangeLabel(d)}`, "", ...lines, "",
    `Total hours: ${formatHoursValue(totals.effective)}`, "Scheduled hours are not verified actual work."].join("\n");
}

export async function buildTimesheetPdf(d: TimesheetDoc) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const totals = timesheetTotals(d.rows);
  let y = 60;
  pdf.setFont("helvetica", "bold").setFontSize(18).text("Timesheet", 50, y); y += 26;
  pdf.setFont("helvetica", "normal").setFontSize(11);
  for (const line of [`Caregiver: ${d.caregiverName}`, `Family: ${d.familyName}`, `Period: ${rangeLabel(d)}`, `Time zone: ${d.timezone}`]) { pdf.text(line, 50, y); y += 16; }
  y += 12;
  const cols = [50, 170, 260, 350, 420];
  pdf.setFont("helvetica", "bold");
  ["Date", "Start", "End", "Hours", "Status"].forEach((h, i) => pdf.text(h, cols[i] ?? 50, y));
  pdf.line(50, y + 5, 560, y + 5); y += 20; pdf.setFont("helvetica", "normal");
  for (const r of d.rows) {
    if (y > 720) { pdf.addPage(); y = 60; }
    const cells = [formatInTimeZone(r.actualStart, d.timezone, "EEE, MMM d"),
      t(r.actualStart, d.timezone), t(r.actualEnd, d.timezone),
      formatHoursValue(r.actualHours), r.confirmed ? (r.removed ? "Adjusted (removed)" : "Adjusted actual") : "Scheduled"];
    cells.forEach((c, i) => pdf.text(c, cols[i] ?? 50, y)); y += 18;
    if (r.note) { pdf.setFontSize(9).text(pdf.splitTextToSize(`Note: ${r.note}`, 490), 60, y - 4); pdf.setFontSize(11); y += 12; }
  }
  if (!d.rows.length) { pdf.text("No shifts this period.", 50, y); y += 18; }
  pdf.line(50, y, 560, y); y += 20;
  if (y > 700) { pdf.addPage(); y = 60; }
  pdf.setFont("helvetica", "bold").text(`Total: ${formatHoursValue(totals.effective)} hours`, 50, y); y += 16;
  pdf.setFont("helvetica", "normal");
  pdf.text("Scheduled hours are not verified actual work.", 50, y);
  pdf.setFontSize(9).text(`Generated ${formatInTimeZone(new Date(), d.timezone, "MMM d, yyyy h:mm a")} · Our Family Calendar`, 50, 760);
  return pdf;
}
