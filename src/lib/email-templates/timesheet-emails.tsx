import * as React from "react";

import type { TemplateEntry } from "./registry";
import { ReviewEmailShell, ShellText } from "./review-email-shell";

interface Base {
  householdName?: string;
  periodLabel?: string;
  url?: string;
  caregiverName?: string;
}

const footer = "You're receiving this because timesheets are turned on for your household.";

function Ready({ householdName, periodLabel, url, scheduledHours }: Base & { scheduledHours?: string }) {
  const period = periodLabel ?? "this pay period";
  return (
    <ReviewEmailShell preview={`Your timesheet for ${period} is ready`} heading="Time to check your hours" url={url}
      actionLabel="Review timesheet" browserLabel="Open timesheet in browser" footerNote={footer} showMotif>
      <ShellText>The pay period {period} with {householdName ?? "your family"} has ended. Take a quick look at your hours and submit when they look right.</ShellText>
      {scheduledHours ? <ShellText>Scheduled: {scheduledHours}</ShellText> : null}
    </ReviewEmailShell>
  );
}

function Reminder({ householdName, periodLabel, url }: Base) {
  return (
    <ReviewEmailShell preview="Your timesheet hasn't been submitted yet" heading="Just a friendly nudge" url={url}
      actionLabel="Review timesheet" browserLabel="Open timesheet in browser" footerNote={footer} showMotif>
      {`Your timesheet for ${periodLabel ?? "the last pay period"} with ${householdName ?? "your family"} is still waiting to be submitted.`}
    </ReviewEmailShell>
  );
}

function Submitted({ caregiverName, periodLabel, url }: Base) {
  const name = caregiverName ?? "Your caregiver";
  return (
    <ReviewEmailShell preview={`${name}’s timesheet for ${periodLabel ?? "the last pay period"} is ready to review.`}
      heading="Ready for your review" url={url} actionLabel="Review timesheet →" browserLabel="Open timesheet in browser" showMotif>
      {`${name}’s timesheet for ${periodLabel ?? "the last pay period"} is ready to review.`}
    </ReviewEmailShell>
  );
}

function Correction({ periodLabel, url, note }: Base & { note?: string | null }) {
  return (
    <ReviewEmailShell preview="A change was requested on your timesheet" heading="A quick update is needed" url={url}
      actionLabel="Update timesheet" browserLabel="Open timesheet in browser" footerNote={footer} showMotif>
      <ShellText>Please take another look at your timesheet for {periodLabel ?? "this pay period"}.</ShellText>
      {note ? <ShellText>Note: {note}</ShellText> : null}
    </ReviewEmailShell>
  );
}

function Approved({ periodLabel, totalHours }: Base & { totalHours?: string }) {
  return (
    <ReviewEmailShell preview="Your timesheet was approved" heading="All set — thank you!" footerNote={footer} showMotif>
      <ShellText>Your timesheet for {periodLabel ?? "this pay period"} has been approved.</ShellText>
      <ShellText>Approved hours: {totalHours ?? "0h"}</ShellText>
    </ReviewEmailShell>
  );
}

function EmailsOff({ caregiverName, householdName }: Base) {
  const name = caregiverName ?? "Your caregiver";
  return (
    <ReviewEmailShell preview={`${name} turned off timesheet emails`} heading="Timesheet emails paused">
      {`${name} won't receive timesheet emails from ${householdName ?? "your household"} anymore. They can still open their timesheet in the app.`}
    </ReviewEmailShell>
  );
}

const period = { periodLabel: "Sep 14 – Sep 27, 2026", householdName: "Parker Family", url: "https://ourfamilycalendar.com/timesheet" };

export const timesheetReady = {
  component: Ready, subject: "Your Timesheet Is Ready to Review", displayName: "Timesheet ready",
  previewData: { ...period, scheduledHours: "24h" },
} satisfies TemplateEntry;
export const timesheetReminder = {
  component: Reminder, subject: "Reminder: Submit Your Timesheet", displayName: "Timesheet reminder", previewData: period,
} satisfies TemplateEntry;
export const timesheetSubmitted = {
  component: Submitted,
  subject: (d: Record<string, any>) => `${d["caregiverName"] ?? "Caregiver"} Submitted Her Timesheet`,
  displayName: "Timesheet submitted",
  previewData: { ...period, caregiverName: "Michelle" },
} satisfies TemplateEntry;
export const timesheetCorrection = {
  component: Correction, subject: "Please Update Your Timesheet", displayName: "Timesheet correction",
  previewData: { ...period, note: "Tuesday ended at 4pm." },
} satisfies TemplateEntry;
export const timesheetApproved = {
  component: Approved, subject: "Your Timesheet Was Approved", displayName: "Timesheet approved",
  previewData: { ...period, totalHours: "24h" },
} satisfies TemplateEntry;
export const timesheetEmailsOff = {
  component: EmailsOff,
  subject: (d: Record<string, any>) => `${d["caregiverName"] ?? "A Caregiver"} Turned Off Timesheet Emails`,
  displayName: "Caregiver turned off timesheet emails",
  previewData: { caregiverName: "Michelle", householdName: "Parker Family" },
} satisfies TemplateEntry;
