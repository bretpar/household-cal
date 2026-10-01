import type { ComponentType } from 'react'

import { template as calendarSummaryTemplate } from './calendar-summary'
import { template as householdInvitationTemplate } from './household-invitation'
import {
  timesheetApproved,
  timesheetCorrection,
  timesheetEmailsOff,
  timesheetReady,
  timesheetReminder,
  timesheetSubmitted,
} from './timesheet-emails'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'household-invitation': householdInvitationTemplate,
  'calendar-summary': calendarSummaryTemplate,
  'timesheet-ready': timesheetReady,
  'timesheet-reminder': timesheetReminder,
  'timesheet-submitted': timesheetSubmitted,
  'timesheet-correction': timesheetCorrection,
  'timesheet-approved': timesheetApproved,
  'timesheet-emails-off': timesheetEmailsOff,
}
