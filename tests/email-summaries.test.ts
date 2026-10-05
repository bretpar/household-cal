import { describe, expect, it } from 'vitest'
import { dueRun, previewWindow } from '@/lib/email-summaries/window'
import { buildSummaryDays, summaryCopy, eventsForSelection, selectedDaysInWindow, occursOnDayKey } from '@/lib/email-summaries/summary'
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
  it('keeps direct and linked events from multiple selected calendars', () => {
    const events = [
      {
        id: 'babysitter', title: 'Michelle', start_at: '2026-09-17T14:30:00Z', end_at: '2026-09-18T00:00:00Z',
        all_day: false, calendar_source_id: 'babysitter-calendar', linked_calendar_source_ids: [],
        display_mode: 'coverage_background', recurrence_rule: null, recurrence_until: null,
      },
      {
        id: 'kids-place', title: 'Kids Place', start_at: '2026-09-17T16:00:00Z', end_at: '2026-09-17T20:00:00Z',
        all_day: false, calendar_source_id: 'family-calendar', linked_calendar_source_ids: ['kids-calendar'],
        display_mode: 'events', recurrence_rule: 'FREQ=DAILY', recurrence_until: '2027-06-11',
      },
    ]

    const selected = eventsForSelection(events, {
      sourceIds: ['kids-calendar', 'babysitter-calendar'],
      mainSourceId: 'family-calendar',
    })

    expect(selected.map((event) => event.title)).toEqual(['Michelle', 'Kids Place'])
  })
  it('monthly BYDAY=1WE anchored Monday occurs on the first Wednesday, not the anchor', () => {
    // VA Monthly Meeting: stored Monday Oct 5 2026, rule FREQ=MONTHLY;BYDAY=1WE
    const event = {
      id: 'va', title: 'VA Monthly Meeting', start_at: '2026-10-05T17:00:00Z', end_at: '2026-10-05T18:00:00Z',
      all_day: false, calendar_source_id: null, display_mode: 'events',
      recurrence_rule: 'FREQ=MONTHLY;BYDAY=1WE', recurrence_until: null, excluded_dates: [],
      participants: [], member_ids: [],
    }
    expect(occursOnDayKey(event as any, '2026-10-05', tz)).toBe(false)
    expect(occursOnDayKey(event as any, '2026-10-07', tz)).toBe(true)
    expect(occursOnDayKey(event as any, '2026-10-14', tz)).toBe(false)
    expect(occursOnDayKey(event as any, '2026-11-04', tz)).toBe(true)
    // weekly email window Mon Oct 5 – Sun Oct 11 shows it on Wednesday
    const w = previewWindow('weekly', new Date('2026-10-05T01:05:00Z'), tz)
    const days = buildSummaryDays([event] as any, w, tz, [])
    expect(days.map((d) => d.dayKey)).toEqual(['2026-10-07'])
    expect(days[0].items[0].time).toContain('10:00 AM')
  })
  it('monthly without BYDAY still repeats on the same numbered day', () => {
    const event = {
      id: 'm', title: 'Rent', start_at: '2026-10-05T15:00:00Z', end_at: '2026-10-05T16:00:00Z',
      all_day: false, calendar_source_id: null, display_mode: 'events',
      recurrence_rule: 'FREQ=MONTHLY', recurrence_until: null, excluded_dates: [],
      participants: [], member_ids: [],
    }
    expect(occursOnDayKey(event as any, '2026-10-05', tz)).toBe(true)
    expect(occursOnDayKey(event as any, '2026-11-05', tz)).toBe(true)
    expect(occursOnDayKey(event as any, '2026-11-06', tz)).toBe(false)
  })
  it('monthly BYDAY still respects COUNT and recurrence_until', () => {
    const base = {
      id: 'c', title: 'Club', start_at: '2026-10-05T17:00:00Z', end_at: '2026-10-05T18:00:00Z',
      all_day: false, calendar_source_id: null, display_mode: 'events',
      excluded_dates: [], participants: [], member_ids: [],
    }
    const counted = { ...base, recurrence_rule: 'FREQ=MONTHLY;BYDAY=1WE;COUNT=2', recurrence_until: null }
    expect(occursOnDayKey(counted as any, '2026-10-07', tz)).toBe(true)
    expect(occursOnDayKey(counted as any, '2026-11-04', tz)).toBe(true)
    expect(occursOnDayKey(counted as any, '2026-12-02', tz)).toBe(false)
    const limited = { ...base, recurrence_rule: 'FREQ=MONTHLY;BYDAY=1WE', recurrence_until: '2026-11-30' }
    expect(occursOnDayKey(limited as any, '2026-11-04', tz)).toBe(true)
    expect(occursOnDayKey(limited as any, '2026-12-02', tz)).toBe(false)
  })
})
