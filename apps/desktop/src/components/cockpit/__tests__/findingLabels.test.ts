import { describe, expect, it } from 'vitest'
import { compactDateList, groupLabel, targetLabel, weekdayDate } from '../findingLabels'

/** Minimal stand-in for vue-i18n's `t`: the key plus its named params, so the tests see what was passed. */
const t = (key: string, named: Record<string, unknown> = {}) =>
  `${key}${Object.keys(named).length ? ' ' + JSON.stringify(named) : ''}`

describe('findingLabels', () => {
  it('weekdayDate reads the calendar date without converting it', () => {
    expect(weekdayDate('2031-01-29')).toBe('Mi 29.01.')
    expect(weekdayDate('2031-01-24')).toBe('Fr 24.01.')
  })

  it('targetLabel: day, activity with and without number, camp, document', () => {
    expect(targetLabel(t, { kind: 'day', dayIri: '/api/days/1', date: '2031-01-26' })).toBe('So 26.01.')
    expect(targetLabel(t, { kind: 'activity', activityIri: '/a/1', number: '1.1', title: 'Ski', date: null })).toBe(
      'findings.triage.target.activity {"number":"1.1","title":"Ski"}',
    )
    expect(targetLabel(t, { kind: 'activity', activityIri: '/a/1', number: null, title: 'Ski', date: null })).toBe(
      'findings.triage.target.activityNoNumber {"title":"Ski"}',
    )
    expect(targetLabel(t, { kind: 'camp' })).toBe('findings.triage.target.camp')
    expect(targetLabel(t, { kind: 'document', documentId: 'd1' })).toBe('findings.triage.target.document')
  })

  it('compactDateList drops the year only when all dates share it', () => {
    expect(compactDateList(['2031-01-24', '2031-01-25', '2031-01-26'])).toBe('24.–26.01.')
    expect(compactDateList(['2031-01-26', '2031-01-29'])).toBe('26., 29.01.')
    expect(compactDateList(['2030-12-31', '2031-01-01', '2031-01-02'])).toMatch(/2031$/)
    expect(compactDateList([])).toBe('')
  })

  it('groupLabel keeps a date range together and falls back without dates', () => {
    const label = groupLabel(t, 'Fixpunkte', 3, ['2031-01-24', '2031-01-25', '2031-01-26'])
    expect(label).toContain('"count":3')
    expect(label).toContain('24.–\u206026.01.')
    expect(groupLabel(t, 'Fixpunkte', 2, [])).toBe('findings.group.labelNoDates {"title":"Fixpunkte","count":2}')
  })
})
