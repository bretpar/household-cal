import { describe, expect, it } from 'vitest'
import { previewWindow } from '@/lib/email-summaries/window'
import { addDays } from '@/lib/email-summaries/window'
import { buildCaregiverShiftDays } from '@/lib/email-summaries/summary'

const tz = 'America/Los_Angeles'
const ev = (id: string, title: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, title, start_at: `${day}T16:00:00Z`, end_at: `${day}T17:00:00Z`, all_day: false,
  calendar_source_id: 'x', display_mode: 'events', recurrence_rule: null, recurrence_until: null,
  excluded_dates: [], participants: [], member_ids: [], ...extra,
})

describe('caregiver scheduled-days summary', () => {
  const w = previewWindow('weekly', new Date('2026-08-31T01:05:00Z'), tz)
  const wed = addDays(w.startDayKey, 2)
  const fri = addDays(w.startDayKey, 4)
  const mon = w.startDayKey

  it('includes only the days with an assigned shift', () => {
    const days = buildCaregiverShiftDays([ev('a', 'Babysitting', wed), ev('b', 'Babysitting', fri)] as any, [], w, tz, [])
    expect(days.map((d) => d.dayKey)).toEqual([wed, fri])
  })

  it('returns no days when nothing is assigned', () => {
    expect(buildCaregiverShiftDays([], [ev('k', 'Soccer', mon)] as any, w, tz, [])).toEqual([])
  })

  it('adds related events only on shift days', () => {
    const days = buildCaregiverShiftDays(
      [ev('a', 'Babysitting', wed)] as any,
      [ev('k1', 'Soccer', wed), ev('k2', 'Piano', mon)] as any,
      w, tz, [],
    )
    expect(days.map((d) => d.dayKey)).toEqual([wed])
    expect(days[0].items.map((i) => i.title).sort()).toEqual(['Babysitting', 'Soccer'])
  })
})
