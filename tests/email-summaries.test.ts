import { describe, expect, it } from 'vitest'
import { dueRun, previewWindow } from '@/lib/email-summaries/window'
import { buildSummaryDays, summaryCopy, eventsForSelection, selectedDaysInWindow } from '@/lib/email-summaries/summary'
import { normalizeWeekdays } from '@/lib/email-summaries/settings.server'

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
  it('keeps only a recipient\'s selected weekdays', () => {
    const w = previewWindow('weekly', new Date('2026-08-31T01:05:00Z'), tz)
    const daily = {
      id: '1', title: 'Camp', start_at: `${w.startDayKey}T17:00:00Z`, end_at: `${w.startDayKey}T18:00:00Z`,
      all_day: false, calendar_source_id: null, display_mode: 'events',
      recurrence_rule: 'FREQ=DAILY;INTERVAL=1', recurrence_until: null, excluded_dates: [],
      participants: [], member_ids: [],
    }
    const all = buildSummaryDays([daily] as any, w, tz, [])
    expect(all.length).toBe(7)
    const some = buildSummaryDays([daily] as any, w, tz, [], ['MO', 'WE', 'TH'])
    expect(some.length).toBe(3)
    expect(some.every((d) => /Monday|Wednesday|Thursday/.test(d.label))).toBe(true)
  })
  it('daily window with an excluded weekday yields no days', () => {
    const w = previewWindow('daily', new Date('2026-08-31T01:05:00Z'), tz)
    expect(selectedDaysInWindow(w, ['SA']).length).toBe(0)
    expect(selectedDaysInWindow(w, []).length).toBe(1)
  })
  it('all seven days normalizes to all days', () => {
    expect(normalizeWeekdays(['MO','TU','WE','TH','FR','SA','SU'])).toEqual([])
    expect(normalizeWeekdays(['th','mo'])).toEqual(['MO','TH'])
  })
})
