import { describe, expect, it, vi } from 'vitest'
import { upcomingRun } from '@/lib/email-summaries/window'
import {
  PRESEND_LEAD_MS,
  refreshForPreview,
  refreshForSchedule,
  relevantSourceIds,
} from '@/lib/email-summaries/presend.server'

const tz = 'America/Los_Angeles'
const schedule = { id: 'sched-1', family_id: 'fam-1' }

/**
 * Minimal stand-in for the service-role client: just enough of the query builder
 * for the pre-send bookkeeping table and recipient calendar selections.
 */
function fakeDb(options: {
  recipients?: { id: string; unsubscribed_at?: string | null; calendars: string[] }[]
} = {}) {
  const presyncs: any[] = []
  const recipients = options.recipients ?? [{ id: 'r1', calendars: ['cal-a'] }]

  function builder(table: string) {
    const filters: [string, any][] = []
    const api: any = {
      select: () => api,
      eq: (col: string, value: any) => {
        filters.push([col, value])
        return api
      },
      maybeSingle: async () => ({ data: rows(table).find(match(filters)) ?? null }),
      insert: async (row: any) => {
        if (table === 'email_summary_presyncs') {
          const clash = presyncs.some(
            (p) => p.schedule_id === row.schedule_id && p.period_key === row.period_key,
          )
          if (clash) return { error: { code: '23505' } }
          presyncs.push({ id: `p${presyncs.length + 1}`, started_at: new Date().toISOString(), ...row })
          return { error: null }
        }
        return { error: null }
      },
      update: (patch: any) => ({
        eq: (col: string, value: any) => {
          filters.push([col, value])
          const target = { ...api, then: undefined }
          const apply = () => {
            for (const row of rows(table).filter(match(filters))) Object.assign(row, patch)
          }
          const chain: any = {
            eq: (c: string, v: any) => {
              filters.push([c, v])
              return chain
            },
            then: (resolve: any) => {
              apply()
              return Promise.resolve({ error: null }).then(resolve)
            },
          }
          void target
          return chain
        },
      }),
      then: (resolve: any) => Promise.resolve({ data: rows(table) }).then(resolve),
    }
    return api
  }

  function rows(table: string): any[] {
    if (table === 'email_summary_presyncs') return presyncs
    if (table === 'email_schedule_recipients') {
      return recipients.map((r) => ({
        id: r.id,
        unsubscribed_at: r.unsubscribed_at ?? null,
        email_schedule_recipient_calendars: r.calendars.map((c) => ({ calendar_source_id: c })),
      }))
    }
    return []
  }

  function match(filters: [string, any][]) {
    return (row: any) => filters.every(([col, value]) => row[col] === value)
  }

  return { from: builder, presyncs }
}

describe('pre-send calendar refresh', () => {
  it('fires 5 minutes before a Sunday 6pm weekly send, not earlier', () => {
    const weekly = { frequency: 'weekly' as const, send_time: '18:00:00' }
    // Sunday Aug 30 2026, 17:56 PDT = 00:56Z Aug 31
    const atFiveFiftySix = upcomingRun(weekly, new Date('2026-08-31T00:56:00Z'), tz, PRESEND_LEAD_MS)
    expect(atFiveFiftySix?.window.periodKey).toBe('weekly:2026-08-31')
    // 5:30 PM local is still too early
    expect(upcomingRun(weekly, new Date('2026-08-31T00:30:00Z'), tz, PRESEND_LEAD_MS)).toBeNull()
  })

  it('covers daily and monthly schedules too', () => {
    const daily = { frequency: 'daily' as const, send_time: '18:00:00' }
    expect(
      upcomingRun(daily, new Date('2026-08-27T00:57:00Z'), tz, PRESEND_LEAD_MS)?.window.periodKey,
    ).toBe('daily:2026-08-27')
    const monthly = { frequency: 'monthly' as const, send_time: '18:00:00' }
    // Aug 29 2026 17:57 PDT — three days before September starts
    expect(
      upcomingRun(monthly, new Date('2026-08-30T00:57:00Z'), tz, PRESEND_LEAD_MS)?.window.periodKey,
    ).toBe('monthly:2026-09')
  })

  it('syncs only the calendars the recipients read', async () => {
    const db = fakeDb({
      recipients: [
        { id: 'r1', calendars: ['cal-a'] },
        { id: 'r2', calendars: ['cal-b'] },
        { id: 'r3', unsubscribed_at: '2026-01-01T00:00:00Z', calendars: ['cal-zz'] },
      ],
    })
    expect((await relevantSourceIds(db as any, schedule.id))?.sort()).toEqual(['cal-a', 'cal-b'])

    const pull = vi.fn().mockResolvedValue({ applied: 3, failed: 0 })
    const result = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    expect(result.status).toBe('refreshed')
    expect(pull.mock.calls[0]?.[2]?.sort()).toEqual(['cal-a', 'cal-b'])
  })

  it('falls back to every calendar when a recipient has no selection', async () => {
    const db = fakeDb({ recipients: [{ id: 'r1', calendars: [] }] })
    expect(await relevantSourceIds(db as any, schedule.id)).toBeNull()
  })

  it('runs once per period, so retries cannot duplicate imports', async () => {
    const db = fakeDb()
    const pull = vi.fn().mockResolvedValue({ applied: 1, failed: 0 })
    const first = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    const second = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    expect(first.status).toBe('refreshed')
    expect(second.status).toBe('already_done')
    expect(pull).toHaveBeenCalledTimes(1)
    expect(db.presyncs).toHaveLength(1)
  })

  it('retries a failure a bounded number of times and then gives up', async () => {
    const db = fakeDb()
    const pull = vi.fn().mockRejectedValue(new Error('google timeout'))
    const first = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    expect(first.status).toBe('failed')
    const retry = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    expect(retry.status).toBe('failed')
    const third = await refreshForSchedule(db as any, schedule, 'weekly:2026-08-31', { pull })
    expect(third.status).toBe('exhausted')
    expect(pull).toHaveBeenCalledTimes(2)
    expect(db.presyncs[0]?.status).toBe('failed')
    expect(db.presyncs[0]?.detail).toContain('google timeout')
  })

  it('records a partial calendar failure without throwing', async () => {
    const db = fakeDb()
    const pull = vi.fn().mockResolvedValue({ applied: 0, failed: 1 })
    const result = await refreshForSchedule(db as any, schedule, 'daily:2026-08-27', { pull })
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('failed to sync')
  })

  it('treats a household without Google as a clean skip', async () => {
    const db = fakeDb()
    const pull = vi.fn().mockResolvedValue({ skipped: 'not_connected' })
    const result = await refreshForSchedule(db as any, schedule, 'daily:2026-08-27', { pull })
    expect(result.status).toBe('not_connected')
  })

  it('never lets a preview refresh throw', async () => {
    const db = fakeDb()
    const pull = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(refreshForPreview(db as any, schedule, { pull })).resolves.toEqual({
      refreshed: false,
      detail: 'boom',
    })
  })
})
