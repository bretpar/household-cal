import { describe, expect, it } from 'vitest'
import { emailSelectableCalendars, isEmailSelectableCalendar } from '@/lib/email-summaries/eligibility'

describe('email summary calendar eligibility', () => {
  const google = { id: 'g', active: true, display_mode: 'events', selectable_in_email: true }
  const localReal = { id: 'l', active: true, display_mode: 'events', selectable_in_email: true }
  const bucket = { id: 'f', active: true, display_mode: 'events', selectable_in_email: false }
  const coverage = { id: 'c', active: true, display_mode: 'coverage_background', selectable_in_email: true }
  const inactive = { id: 'x', active: false, display_mode: 'events', selectable_in_email: true }

  it('keeps every active, explicitly selectable calendar', () => {
    expect(emailSelectableCalendars([google, localReal, bucket, coverage, inactive]).map((s) => s.id)).toEqual(['g', 'l', 'c'])
  })
  it('is not provider based — a local calendar marked selectable qualifies', () => {
    expect(isEmailSelectableCalendar(localReal)).toBe(true)
  })
  it('display style does not affect eligibility — coverage background qualifies', () => {
    expect(isEmailSelectableCalendar(coverage)).toBe(true)
  })

})
