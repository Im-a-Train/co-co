import { describe, expect, it } from 'vitest'
import { addDays, computeAllDeadlines, computeDeadlines, daysBetween, deadlineStatus, landeskartenLeadDays } from '../lib/deadlines'
import { makeCoachInputs } from './factory'

const camp = (start: string | null, end: string | null = null, lastJsDate: string | null = null) => ({
  iri: '/api/camps/c1',
  title: 'L',
  start,
  end,
  lastJsDate,
})
const byKind = (start: string, end: string | null = null, inputs = null as ReturnType<typeof makeCoachInputs> | null, last: string | null = null) =>
  Object.fromEntries(computeDeadlines(camp(start, end, last), inputs).map((d) => [d.kind, d]))

describe('date helpers', () => {
  it('adds days across month and year borders', () => {
    expect(addDays('2031-03-01', -1)).toBe('2031-02-28')
    expect(addDays('2031-01-10', -30)).toBe('2030-12-11')
    expect(addDays('2031-12-31', 1)).toBe('2032-01-01')
    expect(daysBetween('2031-01-01', '2031-01-31')).toBe(30)
  })
  it('landeskarten lead time depends on the season', () => {
    expect(landeskartenLeadDays('2031-06-01')).toBe(35)
    expect(landeskartenLeadDays('2031-08-31')).toBe(35)
    expect(landeskartenLeadDays('2031-05-31')).toBe(21)
    expect(landeskartenLeadDays('2031-09-01')).toBe(21)
  })
})

describe('computeDeadlines', () => {
  it('returns nothing without a start date', () => {
    expect(computeDeadlines(camp(null), null)).toEqual([])
  })

  it('computes T-30, T+30 after last J+S date, T-5w, T-3w and T-21', () => {
    const d = byKind('2031-04-20', '2031-04-26', null, '2031-04-25')
    expect(d['nds-registration'].due).toBe('2031-03-21')
    expect(d['nds-closing'].due).toBe('2031-05-25')
    expect(d['leihmaterial'].due).toBe('2031-03-16')
    expect(d['landeskarten'].due).toBe('2031-03-30')
    expect(d['lagerbewilligung'].due).toBe('2031-03-30')
  })

  it('uses T-5w for Landeskarten in summer and camp end when no J+S date is known', () => {
    const d = byKind('2031-07-12', '2031-07-19')
    expect(d['landeskarten'].due).toBe('2031-06-07')
    expect(d['nds-closing'].due).toBe('2031-08-18')
  })

  it('takes done flags and rule ids from inputs', () => {
    const d = byKind('2031-07-12', '2031-07-19', makeCoachInputs({ ndsRegistered: true, landeskartenOrdered: true }))
    expect(d['nds-registration']).toMatchObject({ done: true, ruleId: 'JS-DL-01' })
    expect(d['landeskarten'].done).toBe(true)
    expect(d['leihmaterial'].done).toBe(false)
    expect(d['nds-closing'].ruleId).toBe('JS-DL-02')
    expect(d['lagerbewilligung'].ruleId).toBeNull()
    expect(d['nds-registration'].source?.url).toContain('jugendundsport.ch')
  })
})

describe('deadlineStatus / computeAllDeadlines', () => {
  it('classifies done, overdue, soon and open', () => {
    expect(deadlineStatus({ due: '2031-01-01', done: true }, '2031-06-01')).toBe('done')
    expect(deadlineStatus({ due: '2031-05-31', done: false }, '2031-06-01')).toBe('overdue')
    expect(deadlineStatus({ due: '2031-06-01', done: false }, '2031-06-01')).toBe('soon')
    expect(deadlineStatus({ due: '2031-06-15', done: false }, '2031-06-01')).toBe('soon')
    expect(deadlineStatus({ due: '2031-06-16', done: false }, '2031-06-01')).toBe('open')
  })
  it('merges camps sorted by due date and applies the matching coach inputs', () => {
    const a = { iri: '/api/camps/a', title: 'A', start: '2031-07-12', end: '2031-07-19' }
    const b = { iri: '/api/camps/b', title: 'B', start: '2031-04-20', end: '2031-04-26' }
    const all = computeAllDeadlines([a, b], { '/api/camps/b': makeCoachInputs({ ndsRegistered: true }) })
    expect(all).toHaveLength(10)
    expect(all.map((d) => d.due)).toEqual([...all.map((d) => d.due)].sort())
    expect(all.find((d) => d.campTitle === 'B' && d.kind === 'nds-registration')?.done).toBe(true)
    expect(all.find((d) => d.campTitle === 'A' && d.kind === 'nds-registration')?.done).toBe(false)
    expect(computeAllDeadlines([{ ...a, start: null }], {})).toEqual([])
  })
})
