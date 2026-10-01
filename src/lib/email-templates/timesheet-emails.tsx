import * as React from "react";

import type { TemplateEntry } from "./registry";
import { EmailButton, EmailHeading, EmailLinkFallback, EmailShell, EmailSmallText, EmailText } from "./shell";

interface Base {
  householdName?: string;
  periodLabel?: string;
  url?: string;
  caregiverName?: string;
}

const footer = "You're receiving this because timesheets are turned on for your household.";

function Ready({ householdName, periodLabel, url, scheduledHours }: Base & { scheduledHours?: string }) {
  return (
    <EmailShell preview={`Your timesheet for ${periodLabel ?? "this pay period"} is ready`} footerNote={footer}>
      <EmailHeading>Your timesheet is ready to review</EmailHeading>
      <EmailText>
        The pay period {periodLabel ?? ""} for {householdName ?? "your family"} has ended. Please check your hours and submit your timesheet.
      </EmailText>
      {scheduledHours ? <EmailText>Scheduled: {scheduledHours}</EmailText> : null}
      {url ? <EmailButton href={url}>Review Timesheet</EmailButton> : null}
      {url ? <EmailLinkFallback url={url} /> : null}
      <EmailSmallText>You'll need to sign in to see your timesheet.</EmailSmallText>
    </EmailShell>
  );
}

function Reminder({ householdName, periodLabel, url }: Base) {
  return (
    <EmailShell preview="Reminder: your timesheet hasn't been submitted" footerNote={footer}>
      <EmailHeading>Reminder: submit your timesheet</EmailHeading>
      <EmailText>
        Your timesheet for {periodLabel ?? "the last pay period"} with {householdName ?? "your family"} hasn't been submitted yet.
      </EmailText>
      {url ? <EmailButton href={url}>Review Timesheet</EmailButton> : null}
      {url ? <EmailLinkFallback url={url} /> : null}
    </EmailShell>
  );
}

function Submitted({ caregiverName, periodLabel, url }: Base) {
  const name = caregiverName ?? "Your caregiver";
  return (
    <EmailShell preview={`${name} submitted a timesheet`}>
      <EmailHeading>{name} submitted a timesheet</EmailHeading>
      <EmailText>
        Their time card for {periodLabel ?? "the last pay period"} is ready for review.
      </EmailText>
      {url ? <EmailButton href={url}>Review &amp; Confirm Timesheet</EmailButton> : null}
      {url ? <EmailLinkFallback url={url} /> : null}
    </EmailShell>
  );
}

function Correction({ periodLabel, url, note }: Base & { note?: string | null }) {
  return (
    <EmailShell preview="A correction was requested on your timesheet" footerNote={footer}>
      <EmailHeading>Please update your timesheet</EmailHeading>
      <EmailText>A correction was requested for {periodLabel ?? "your timesheet"}.</EmailText>
      {note ? <EmailText>Note: {note}</EmailText> : null}
      {url ? <EmailButton href={url}>Update Timesheet</EmailButton> : null}
      {url ? <EmailLinkFallback url={url} /> : null}
    </EmailShell>
  );
}

function Approved({ periodLabel, totalHours }: Base & { totalHours?: string }) {
  return (
    <EmailShell preview="Your timesheet was approved" footerNote={footer}>
      <EmailHeading>Your timesheet was approved</EmailHeading>
      <EmailText>Your timesheet for {periodLabel ?? "this pay period"} was approved.</EmailText>
      <EmailText>Approved hours: {totalHours ?? "0h"}</EmailText>
    </EmailShell>
  );
}

function EmailsOff({ caregiverName, householdName }: Base) {
  return (
    <EmailShell preview={`${caregiverName ?? "A caregiver"} turned off timesheet emails`}>
      <EmailHeading>{caregiverName ?? "A caregiver"} turned off timesheet emails</EmailHeading>
      <EmailText>
        {caregiverName ?? "Your caregiver"} won't receive timesheet emails from {householdName ?? "your household"} anymore. They can still open their timesheet in the app.
      </EmailText>
    </EmailShell>
  );
}

const period = { periodLabel: "Sep 14 – Sep 27, 2026", householdName: "Parker Family", url: "https://ourfamilycalendar.com/timesheet" };

export const timesheetReady = {
  component: Ready, subject: "Your timesheet is ready to review", displayName: "Timesheet ready",
  previewData: { ...period, scheduledHours: "24h" },
} satisfies TemplateEntry;
export const timesheetReminder = {
  component: Reminder, subject: "Reminder: submit your timesheet", displayName: "Timesheet reminder", previewData: period,
} satisfies TemplateEntry;
export const timesheetSubmitted = {
  component: Submitted,
  subject: (d: Record<string, any>) => `${d["caregiverName"] ?? "Caregiver"} submitted a timesheet`,
  displayName: "Timesheet submitted",
  previewData: { ...period, caregiverName: "Michelle", totalHours: "8h", rows: [{ date: "Mon, Sep 15", time: "9:00 AM – 5:00 PM", hours: "8h", manual: false }] },
} satisfies TemplateEntry;
export const timesheetCorrection = {
  component: Correction, subject: "Please update your timesheet", displayName: "Timesheet correction",
  previewData: { ...period, note: "Tuesday ended at 4pm." },
} satisfies TemplateEntry;
export const timesheetApproved = {
  component: Approved, subject: "Your timesheet was approved", displayName: "Timesheet approved",
  previewData: { ...period, totalHours: "24h" },
} satisfies TemplateEntry;
export const timesheetEmailsOff = {
  component: EmailsOff,
  subject: (d: Record<string, any>) => `${d["caregiverName"] ?? "A caregiver"} turned off timesheet emails`,
  displayName: "Caregiver turned off timesheet emails",
  previewData: { caregiverName: "Michelle", householdName: "Parker Family" },
} satisfies TemplateEntry;
