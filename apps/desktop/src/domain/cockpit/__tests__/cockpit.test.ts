import { describe, expect, it } from 'vitest'
import type { CampFacts, Finding } from '../../types'
import type { JsDayReport } from '../../rules/lib/jsDays'
import {
  assignLanes,
  buildGrid,
  filterFindings,
  formatMinutes,
  groupBySeverity,
  jsDayBars,
  minutesOfDay,
  ruleGroupOf,
  safeExternalUrl,
  topFindings,
  DEFAULT_FINDING_FILTER,
  type GridBlock,
} from '../index'

const finding = (id: string, severity: Finding['severity'], extra: Partial<Finding> = {}): Finding => ({
  id,
  ruleId: id,
  ruleVersion: '1',
  packId: 'basis',
  severity,
  confidence: 'verified',
  title: `t ${id}`,
  message: `m ${id}`,
  scope: 'camp',
  targets: [],
  evidence: [],
  source: null,
  origin: 'rule',
  tags: [],
  override: null,
  ...extra,
})

const facts = {
  days: [{ iri: '/api/days/1', periodIri: 'p', number: 1, dayOffset: 0, date: '2031-01-24', start: '', end: '' }],
  categories: [{ iri: '/api/categories/c1', short: 'LS', name: 'LS', color: '#ff0000', numberingStyle: null }],
  activities: [
    { iri: '/api/activities/a1', title: 'Postenlauf', categoryIri: '/api/categories/c1', responsibleIris: [] },
    { iri: '/api/activities/a2', title: 'Nacht', categoryIri: null, responsibleIris: [] },
  ],
  scheduleEntries: [
    {
      iri: '/api/schedule_entries/e1',
      activityIri: '/api/activities/a1',
      start: '2031-01-24T09:00:00+00:00',
      end: '2031-01-24T11:30:00+00:00',
      durationMinutes: 150,
      number: '1.1',
    },
    {
      iri: '/api/schedule_entries/e2',
      activityIri: '/api/activities/a2',
      start: '2031-01-24T02:00:00+00:00',
      end: '2031-01-24T03:00:00+00:00',
      durationMinutes: 60,
      number: '1.2',
    },
  ],
} as unknown as CampFacts

describe('time helpers', () => {
  it('reads wall clock without timezone shift', () => {
    expect(minutesOfDay('2031-01-24T08:30:00+00:00')).toBe(510)
  })
  it('formats minutes', () => {
    expect(formatMinutes(210)).toBe('3 h 30')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(120)).toBe('2 h')
  })
})

describe('buildGrid', () => {
  it('positions blocks and colours by category, counts hidden entries', () => {
    const g = buildGrid(facts, (iri) => (iri ? 'LS' : 'NONE'), null)
    const day = g.days[0]
    expect(day.blocks).toHaveLength(1)
    expect(day.hiddenEntries).toBe(1)
    const b = day.blocks[0]
    expect(b.topPct).toBeCloseTo(((9 * 60 - 420) / 960) * 100)
    expect(b.heightPct).toBeCloseTo((150 / 960) * 100)
    expect(b.color).toBe('#ff0000')
    expect(day.jsMinutes).toBe(150)
    expect(day.valid).toBeNull()
  })
  it('uses jsDays report for gaps and validity', () => {
    const report = {
      days: [
        {
          dayIri: '/api/days/1',
          date: '2031-01-24',
          number: 1,
          units: [],
          gaps: [{ start: '2031-01-24T11:00:00+00:00', end: '2031-01-24T11:15:00+00:00', minutes: 15, ok: false }],
          jsMinutes: 200,
          unitCount: 2,
          valid: false,
          combinedWith: null,
          validCombined: false,
        },
      ],
      validDayCount: 0,
      totalDayCount: 1,
    } as JsDayReport
    const g = buildGrid(facts, () => 'LS', report)
    expect(g.days[0].badGaps).toHaveLength(1)
    expect(g.days[0].jsMinutes).toBe(200)
    expect(g.days[0].valid).toBe(false)
    expect(jsDayBars(report)[0].minutes).toBe(200)
  })
})

describe('assignLanes', () => {
  const mk = (s: number, e: number): GridBlock => ({ startMin: s, endMin: e, lane: 0, lanes: 1 }) as GridBlock
  it('puts overlapping blocks side by side', () => {
    const a = mk(540, 600)
    const b = mk(560, 620)
    const c = mk(700, 720)
    assignLanes([a, b, c])
    expect([a.lane, b.lane]).toEqual([0, 1])
    expect(a.lanes).toBe(2)
    expect(c.lanes).toBe(1)
  })
})

describe('findings helpers', () => {
  const overridden = finding('CMP-ACT-01', 'should', {
    override: { id: 'o', campIri: 'c', findingId: 'x', ruleId: 'CMP-ACT-01', reason: 'r', createdAt: '' },
  })
  const list = [
    finding('JS-DAY-01', 'must'),
    finding('SAFE-WX-01', 'should', { targets: ['/api/activities/a1'], module: 'lst-lager' }),
    finding('BP-REST-01', 'hint'),
    overridden,
  ]
  it('derives rule groups', () => {
    expect(ruleGroupOf({ ruleId: 'JS-DAY-01', module: 'lst' })).toBe('lst')
    expect(ruleGroupOf({ ruleId: 'BP-REST-01', module: 'pbs' })).toBe('pbs')
    expect(ruleGroupOf({ ruleId: 'AI-1', module: null })).toBeNull()
  })
  it('filters and groups', () => {
    expect(filterFindings(list, DEFAULT_FINDING_FILTER)).toHaveLength(3)
    expect(filterFindings(list, { ...DEFAULT_FINDING_FILTER, showOverridden: true })).toHaveLength(4)
    expect(filterFindings(list, { ...DEFAULT_FINDING_FILTER, groups: ['lst-lager'] })).toHaveLength(1)
    expect(filterFindings(list, { ...DEFAULT_FINDING_FILTER, activityIri: '/api/activities/a1' })).toHaveLength(1)
    expect(filterFindings(list, { ...DEFAULT_FINDING_FILTER, search: 'bp-rest' })).toHaveLength(1)
    expect(groupBySeverity(list).map((g) => g.severity)).toEqual(['must', 'should', 'hint'])
  })
  it('top findings skip overridden', () => {
    expect(topFindings(list, 2).map((f) => f.id)).toEqual(['JS-DAY-01', 'SAFE-WX-01'])
  })
  it('only allows http(s) links', () => {
    expect(safeExternalUrl('https://www.jugendundsport.ch/de/lager')).toContain('https://')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })
})
