import { describe, expect, it } from 'vitest'
import { dueRun, previewWindow } from '@/lib/email-summaries/window'
import { buildSummaryDays, summaryCopy, eventsForSelection } from '@/lib/email-summaries/summary'

const tz = 'America/Los_Angeles'
describe('summaries', () => {
  it('weekly window is due after Sunday 6pm local', () => {
    const s = { frequency: 'weekly' as const, send_time: '18:00:00' }
    // Sunday Aug 30 2026 18:05 PDT = 01:05Z Aug 31
    const due = dueRun(s, new Date('2026-08-31T01:05:00Z'), tz)
    expect(due?.window.periodKey).toBeTruthy()
    const notYet = dueRun(s, new Date('2026-08-30T20:00:00Z'), tz)
    expect(notYet).toBeNull()
  })
  it('builds day groups and copy', () => {
    const w = previewWindow('weekly', new Date('2026-08-31T01:05:00Z'), tz)
    const events = eventsForSelection([{
      id: '1', title: 'Soccer', start_at: `${w.startDayKey}T23:00:00Z`, end_at: `${w.startDayKey}T23:30:00Z`,
      all_day: false, calendar_source_id: null, display_mode: 'events', recurrence_rule: null,
      recurrence_until: null, excluded_dates: [], participants: [], member_ids: [],
    }] as any, { sourceIds: [], mainSourceId: null })
    const days = buildSummaryDays(events as any, w, tz, [])
    expect(days.length).toBeGreaterThan(0)
    expect(summaryCopy('weekly', w).heading).toBeTruthy()
  })
})
