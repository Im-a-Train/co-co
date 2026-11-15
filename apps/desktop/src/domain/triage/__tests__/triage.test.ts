import { describe, expect, it } from 'vitest'
import {
  backToFindingLocation,
  dayIriOfFinding,
  findingTarget,
  groupFindings,
  isCoachTodo,
  feedbackForFinding,
  findingStatus,
  gridLocationFromFinding,
  nextOpenIndex,
  originFromQuery,
  previousEntryIsOrigin,
  progressOf,
  recallPosition,
  rememberPosition,
  resolveIndex,
  statusesOf,
  stepIndex,
  triageLocation,
  type FindingStatus,
} from '../index'
import type { CampFacts, FeedbackItem, Finding } from '@/domain/types'

const finding = (id: string, over: Partial<Finding> = {}): Finding =>
  ({
    id,
    ruleId: id.split(':')[0]!,
    scope: 'activity',
    targets: [`/api/activities/${id.split(':')[1] ?? 'a'}`],
    evidence: [],
    override: null,
    ...over,
  }) as unknown as Finding

const item = (over: Partial<FeedbackItem>): FeedbackItem =>
  ({ id: 'i1', campIri: '/api/camps/c', scope: 'activity', kind: 'suggestion', text: 'x', status: 'draft', createdAt: '', updatedAt: '', ...over }) as FeedbackItem

describe('status derivation', () => {
  const f = finding('R-1:a1')
  it('open without feedback or override', () => expect(findingStatus(f, [])).toBe('open'))
  it('feedback via findingId', () => expect(findingStatus(f, [item({ findingId: 'R-1:a1' })])).toBe('feedback'))
  it('feedback via ruleId + target when no findingId', () => {
    expect(findingStatus(f, [item({ ruleId: 'R-1', activityIri: '/api/activities/a1' })])).toBe('feedback')
    expect(findingStatus(f, [item({ ruleId: 'R-1', activityIri: '/api/activities/zzz' })])).toBe('open')
    expect(findingStatus(f, [item({ ruleId: 'R-2', activityIri: '/api/activities/a1' })])).toBe('open')
  })
  it('a different findingId does not match even if rule + target do', () => {
    expect(findingStatus(f, [item({ findingId: 'R-1:other', ruleId: 'R-1', activityIri: '/api/activities/a1' })])).toBe('open')
  })
  it('camp-scoped feedback matches non-activity findings of the rule', () => {
    const day = finding('R-9:d1', { scope: 'day', targets: ['/api/days/d1'] })
    expect(feedbackForFinding(day, [item({ scope: 'camp', ruleId: 'R-9' })])).not.toBeNull()
  })
  it('ignored wins', () => {
    const ign = finding('R-1:a1', { override: { id: 'o' } as never })
    expect(findingStatus(ign, [item({ findingId: 'R-1:a1' })])).toBe('ignored')
  })
  it('statusesOf maps the list', () => {
    expect(statusesOf([f, finding('R-2:a2')], [item({ findingId: 'R-1:a1' })])).toEqual(['feedback', 'open'])
  })
})

describe('navigation', () => {
  const s = (...v: FindingStatus[]) => v
  it('next open skips done ones', () => {
    expect(nextOpenIndex(s('open', 'feedback', 'ignored', 'open'), 0)).toBe(3)
  })
  it('wraps around', () => {
    expect(nextOpenIndex(s('open', 'feedback', 'open'), 2)).toBe(0)
  })
  it('skip keeps the current one open and moves on', () => {
    expect(nextOpenIndex(s('open', 'open', 'open'), 1)).toBe(2)
  })
  it('returns -1 when nothing else is open', () => {
    expect(nextOpenIndex(s('feedback', 'feedback'), 0)).toBe(-1)
    expect(nextOpenIndex(s('open'), 0)).toBe(-1)
    expect(nextOpenIndex([], 0)).toBe(-1)
  })
  it('stepIndex wraps both ways', () => {
    expect(stepIndex(3, 2, 1)).toBe(0)
    expect(stepIndex(3, 0, -1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(-1)
  })
  it('progress', () => {
    expect(progressOf(s('open', 'feedback', 'ignored'))).toEqual({ done: 2, total: 3, open: 1 })
  })
  it('resolveIndex finds the key or clamps', () => {
    const list = [finding('A-1:a'), finding('B-1:b')]
    expect(resolveIndex(list, 'B-1:b')).toBe(1)
    expect(resolveIndex(list, 'gone', 5)).toBe(1)
    expect(resolveIndex(list, null)).toBe(0)
    expect(resolveIndex([], 'x')).toBe(-1)
  })
})

describe('position + routing', () => {
  it('remembers the position per camp', () => {
    rememberPosition('/api/camps/c1', 'R-1:a')
    expect(recallPosition('/api/camps/c1')).toBe('R-1:a')
    expect(recallPosition('/api/camps/c2')).toBeNull()
  })
  it('triageLocation points to the findings tab with befund (+ editor) in the query', () => {
    const loc = triageLocation('/api/camps/70ca971c992f', 'R-1:a', { editor: true })
    expect(loc.name).toBe('camp-findings')
    expect(loc.params.campId).toBe('70ca971c992f')
    expect(loc.query).toEqual({ befund: 'R-1:a', editor: '1' })
    expect(triageLocation('/api/camps/x', 'R-1:a').query).toEqual({ befund: 'R-1:a' })
  })
})

describe('Befund -> Raster -> zurück', () => {
  const camp = '/api/camps/70ca971c992f'
  it('gridLocationFromFinding carries activity and origin', () => {
    const loc = gridLocationFromFinding(camp, 'R-1:a', '/api/activities/a1')
    expect(loc.name).toBe('camp-grid')
    expect(loc.params.campId).toBe('70ca971c992f')
    expect(loc.query).toEqual({ activity: '/api/activities/a1', vonBefund: 'R-1:a' })
    const l = gridLocationFromFinding(camp, 'R-1:a', '/api/activities/a1', { list: true, filterActivity: '/api/activities/z' })
    expect(l.query).toMatchObject({ vonAnsicht: 'liste', vonFilter: '/api/activities/z' })
  })
  it('originFromQuery parses and ignores a plain grid query', () => {
    expect(originFromQuery({ activity: 'x' })).toBeNull()
    expect(originFromQuery({ vonBefund: ['a', 'b'] })).toBeNull()
    expect(originFromQuery({ vonBefund: 'R-1:a' })).toEqual({ findingId: 'R-1:a', list: false, filterActivity: null })
  })
  it('round-trips mode and filter back to the Befunde location', () => {
    const q = gridLocationFromFinding(camp, 'R-1:a', '/api/activities/a1', { list: true, filterActivity: '/api/activities/z' }).query
    const origin = originFromQuery(q)!
    const back = backToFindingLocation(camp, origin)
    expect(back.name).toBe('camp-findings')
    expect(back.query).toEqual({ befund: 'R-1:a', ansicht: 'liste', activity: '/api/activities/z' })
    expect(backToFindingLocation(camp, { findingId: 'R-1:a', list: false, filterActivity: null }).query).toEqual({ befund: 'R-1:a' })
  })
  it('previousEntryIsOrigin only accepts the identical Befunde entry', () => {
    const o = { findingId: 'R-1:a', list: false, filterActivity: null }
    const p = '/lager/70ca971c992f/befunde'
    expect(previousEntryIsOrigin(`${p}?befund=R-1%3Aa`, camp, o)).toBe(true)
    expect(previousEntryIsOrigin(`${p}?befund=R-2%3Ab`, camp, o)).toBe(false)
    expect(previousEntryIsOrigin(`${p}?befund=R-1%3Aa&ansicht=liste`, camp, o)).toBe(false)
    expect(previousEntryIsOrigin('/lager/70ca971c992f/raster', camp, o)).toBe(false)
    expect(previousEntryIsOrigin(null, camp, o)).toBe(false)
  })
})

const facts = {
  days: [
    { iri: '/api/days/d1', date: '2026-01-24' },
    { iri: '/api/days/d2', date: '2026-01-25' },
    { iri: '/api/days/d3', date: '2026-01-26' },
  ],
  activities: [{ iri: '/api/activities/a1', title: 'Skifahren' }],
  scheduleEntries: [
    { iri: '/api/se/s1', activityIri: '/api/activities/a1', dayIri: '/api/days/d2', start: '2026-01-25T09:00:00+00:00', number: '2.1' },
  ],
} as unknown as CampFacts

const entry2 = { iri: '/api/se/s2', activityIri: '/api/activities/a1', dayIri: '/api/days/d3', start: '2026-01-26T23:30:00+00:00', number: '3.1' }

const dayF = (rule: string, d: string, over: Partial<Finding> = {}) =>
  finding(`${rule}:${d}`, { ruleId: rule, scope: 'day', severity: 'should', targets: [`/api/days/${d}`], ...over })

describe('isCoachTodo', () => {
  it('is true only with needsInput', () => {
    expect(isCoachTodo(finding('R:a', { needsInput: 'coachInputs' }))).toBe(true)
    expect(isCoachTodo(finding('R:a'))).toBe(false)
  })
})

describe('dayIriOfFinding / findingTarget', () => {
  it('finds the first day target; null without facts or day', () => {
    expect(dayIriOfFinding(dayF('R', 'd2'), facts)).toBe('/api/days/d2')
    expect(dayIriOfFinding(dayF('R', 'd2'), null)).toBeNull()
    expect(dayIriOfFinding(finding('R:a1'), facts)).toBeNull()
  })
  it('day finding', () => {
    expect(findingTarget(dayF('R', 'd3'), facts)).toEqual({ kind: 'day', dayIri: '/api/days/d3', date: '2026-01-26' })
  })
  it('activity finding with number, title and date', () => {
    expect(findingTarget(finding('R:a1'), facts)).toEqual({
      kind: 'activity', activityIri: '/api/activities/a1', number: '2.1', title: 'Skifahren', date: '2026-01-25',
    })
  })
  it('camp finding and no-facts fallback', () => {
    const c = finding('R:c', { scope: 'camp', targets: ['/api/camps/c'] })
    expect(findingTarget(c, facts)).toEqual({ kind: 'camp' })
    expect(findingTarget(dayF('R', 'd1'), null)).toEqual({ kind: 'camp' })
  })
  it('document finding', () => {
    expect(findingTarget(finding('R:x', { scope: 'document', targets: ['doc1'] }), facts)).toEqual({ kind: 'document', documentId: 'doc1' })
  })
  it('a camp finding stays «Lager» even with activity evidence', () => {
    const c = finding('R:c', { scope: 'camp', targets: ['/api/camps/c'], evidence: [{ kind: 'activity', iri: '/api/activities/a1', label: 'x' }] as Finding['evidence'] })
    expect(findingTarget(c, facts)).toEqual({ kind: 'camp' })
  })
  it('a schedule-entry finding names its own block, not the first block of the activity', () => {
    const f2 = { ...facts, scheduleEntries: [...facts.scheduleEntries, entry2] } as CampFacts
    const se = finding('R:s2', { scope: 'scheduleEntry', targets: ['/api/se/s2'] })
    expect(findingTarget(se, f2)).toMatchObject({ kind: 'activity', activityIri: '/api/activities/a1', number: '3.1', date: '2026-01-26' })
    // The activity itself still names its first block.
    expect(findingTarget(finding('R:a1'), f2)).toMatchObject({ number: '2.1', date: '2026-01-25' })
  })
  it('a day finding prefers the day over activity evidence (PROGRAM-11)', () => {
    const d = dayF('R', 'd1', { evidence: [{ kind: 'activity', iri: '/api/activities/a1', label: 'x' }] as Finding['evidence'] })
    expect(findingTarget(d, facts)).toEqual({ kind: 'day', dayIri: '/api/days/d1', date: '2026-01-24' })
    expect(dayIriOfFinding(d, facts)).toBe('/api/days/d1')
  })
})

describe('groupFindings', () => {
  it('returns an empty list for no findings', () => expect(groupFindings([], facts)).toEqual([]))
  it('groups >= 2 same-rule day findings, sorted by date, with dates', () => {
    const g = groupFindings([dayF('J', 'd3'), dayF('J', 'd1'), dayF('J', 'd2')], facts)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ key: 'group:J', ruleId: 'J', severity: 'should', dates: ['2026-01-24', '2026-01-25', '2026-01-26'] })
    expect(g[0]!.findings.map((f) => f.id)).toEqual(['J:d1', 'J:d2', 'J:d3'])
  })
  it('a single day finding and activity findings stay single', () => {
    const g = groupFindings([dayF('J', 'd1'), finding('A:a1'), finding('A:a2')], facts)
    expect(g.map((e) => e.key)).toEqual(['J:d1', 'A:a1', 'A:a2'])
    expect(g[0]!.dates).toEqual(['2026-01-24'])
  })
  it('keeps order of first appearance and never hides a Muss (group severity = most severe)', () => {
    const g = groupFindings([finding('A:a1'), dayF('J', 'd1'), finding('B:a1'), dayF('J', 'd2', { severity: 'must' })], facts)
    expect(g.map((e) => e.key)).toEqual(['A:a1', 'group:J', 'B:a1'])
    expect(g[1]!.severity).toBe('must')
    expect(g[1]!.findings).toHaveLength(2)
  })
  it('sorts adjacent single findings of one rule by date / block number; other rules keep their place', () => {
    const f3 = {
      ...facts,
      activities: [...facts.activities, { iri: '/api/activities/a2', title: 'Snowboard' }, { iri: '/api/activities/a3', title: 'Lotto' }],
      scheduleEntries: [
        ...facts.scheduleEntries,
        { iri: '/api/se/s3', activityIri: '/api/activities/a2', dayIri: '/api/days/d1', start: '2026-01-24T14:00:00+00:00', number: '1.2' },
        { iri: '/api/se/s4', activityIri: '/api/activities/a3', dayIri: '/api/days/d1', start: '2026-01-24T09:00:00+00:00', number: '1.1' },
      ],
    } as unknown as CampFacts
    // Engine order is by hash id: a1 (25.01.), a3 (24.01. 1.1), a2 (24.01. 1.2), then rule B.
    const g = groupFindings([finding('B:a2'), finding('A:a1'), finding('A:a2'), finding('A:a3'), finding('C:a1')], f3)
    expect(g.map((e) => e.key)).toEqual(['B:a2', 'A:a3', 'A:a2', 'A:a1', 'C:a1'])
    expect(g[1]!.dates).toEqual(['2026-01-24'])
  })
  it('keeps a Muss first within a rule even when a milder finding has an earlier date', () => {
    // The hint is about 24.01. (day fallback), the Muss about 25.01.
    const g = groupFindings([finding('A:a1', { severity: 'must' }), dayF('A', 'd1', { scope: 'activity', severity: 'hint' })], facts)
    expect(g.map((e) => [e.severity, e.dates[0]])).toEqual([['must', '2026-01-25'], ['hint', '2026-01-24']])
  })
  it('different rules form separate groups; works without facts', () => {
    const g = groupFindings([dayF('J', 'd1'), dayF('K', 'd1'), dayF('J', 'd2'), dayF('K', 'd2')], null)
    expect(g.map((e) => e.key)).toEqual(['group:J', 'group:K'])
    expect(g[0]!.dates).toEqual([])
  })
})

describe('findingIds-aware statuses', () => {
  const a = dayF('J', 'd1')
  const b = dayF('J', 'd2')
  const grouped = item({ findingId: 'J:d1', findingIds: ['J:d1', 'J:d2'], scope: 'camp' })
  it('every finding of the group is covered', () => {
    expect(statusesOf([a, b, dayF('J', 'd3')], [grouped])).toEqual(['feedback', 'feedback', 'open'])
    expect(feedbackForFinding(b, [grouped])).toBe(grouped)
  })
  it('findingIds wins over a differing findingId', () => {
    expect(findingStatus(b, [item({ findingId: 'J:d1', findingIds: ['J:d2'] })])).toBe('feedback')
    expect(findingStatus(a, [item({ findingId: 'J:d1', findingIds: ['J:d2'] })])).toBe('open')
  })
})

describe('gridLocationFromFinding with a day', () => {
  it('uses tag and no activity', () => {
    const loc = gridLocationFromFinding('/api/camps/c1', 'J:d1', null, { dayIri: '/api/days/d1' })
    expect(loc.query).toEqual({ tag: '/api/days/d1', vonBefund: 'J:d1' })
  })
  it('activity form is unchanged', () => {
    expect(gridLocationFromFinding('/api/camps/c1', 'R:a1', '/api/activities/a1').query).toEqual({ activity: '/api/activities/a1', vonBefund: 'R:a1' })
  })
})
