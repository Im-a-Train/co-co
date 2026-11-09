import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CampFacts, CategoryClass, Finding } from '../../../domain/types'
import {
  DEFAULT_ROW_FILTER,
  buildRows,
  compareNumbers,
  filterRows,
  sortRows,
  stateFromQuery,
  stateToQuery,
} from '../activityRows'

const facts = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../__tests__/fixtures/camps/auf-in-die-berge.facts.json', import.meta.url)), 'utf8'),
) as CampFacts

const classOf = (iri: string | null): CategoryClass => (iri === facts.categories[0]?.iri ? 'LS' : 'ES')

const finding = (id: string, severity: Finding['severity'], target: string): Finding => ({
  id,
  ruleId: id,
  ruleVersion: '1',
  packId: 'basis',
  severity,
  confidence: 'verified',
  title: id,
  message: id,
  scope: 'activity',
  targets: [target],
  evidence: [],
  source: null,
  origin: 'rule',
} as unknown as Finding)

describe('buildRows', () => {
  const a0 = facts.activities[0]!
  const a1 = facts.activities[1]!
  const rows = buildRows(
    facts,
    [finding('f1', 'must', a0.iri), finding('f2', 'hint', a0.iri), finding('f3', 'should', facts.scheduleEntries.find((e) => e.activityIri === a1.iri)!.iri)],
    [{ activityIris: [a1.iri] }, { activityIris: [a1.iri, a0.iri] }],
    classOf,
  )

  it('builds one row per activity with the first entry number and wall-clock start', () => {
    expect(rows).toHaveLength(facts.activities.length)
    for (const r of rows) {
      const first = facts.scheduleEntries.filter((e) => e.activityIri === r.iri).map((e) => e.start.slice(0, 16)).sort()[0]
      expect(r.firstStart).toBe(first)
      expect(r.entries.length).toBe(facts.scheduleEntries.filter((e) => e.activityIri === r.iri).length)
    }
  })

  it('counts findings per severity (activity and schedule entry targets) and documents', () => {
    const r0 = rows.find((r) => r.iri === a0.iri)!
    const r1 = rows.find((r) => r.iri === a1.iri)!
    expect(r0.findings).toEqual({ must: 1, should: 0, hint: 1 })
    expect(r0.findingCount).toBe(2)
    expect(r1.findings.should).toBe(1)
    expect(r0.documentCount).toBe(1)
    expect(r1.documentCount).toBe(2)
  })

  it('resolves category, class, responsibles and progress', () => {
    const r0 = rows.find((r) => r.iri === a0.iri)!
    expect(r0.categoryShort).toBe(facts.categories.find((c) => c.iri === a0.categoryIri)!.short)
    expect(r0.categoryClass).toBe(classOf(a0.categoryIri))
    expect(r0.responsibles.length).toBe(a0.responsibleIris.length)
    expect(r0.progress).toBe(facts.progressLabels.find((p) => p.iri === a0.progressLabelIri)?.title ?? '')
  })
})

describe('manualCount', () => {
  const a0 = facts.activities[0]!
  const a1 = facts.activities[1]!
  const manual = { ...finding('manual:1', 'should', a0.iri), origin: 'manual' } as Finding
  const rows = buildRows(facts, [manual, { ...manual, id: 'manual:2' }, finding('f1', 'must', a1.iri)], [], classOf)

  it('counts manual findings separately from rule findings', () => {
    const r0 = rows.find((r) => r.iri === a0.iri)!
    expect(r0.manualCount).toBe(2)
    expect(r0.findingCount).toBe(0)
    expect(rows.find((r) => r.iri === a1.iri)!.manualCount).toBe(0)
  })

  it('keeps rows with only manual findings in the only-findings filter', () => {
    const iris = filterRows(rows, { ...DEFAULT_ROW_FILTER, onlyFindings: true }).map((r) => r.iri)
    expect(iris).toContain(a0.iri)
    expect(iris).toContain(a1.iri)
  })
})

describe('filter and sort', () => {
  const rows = buildRows(facts, [finding('f1', 'must', facts.activities[0]!.iri)], [], classOf)

  it('filters by text over title, location and responsibles', () => {
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, q: 'snowboard' }).map((r) => r.title)).toContain('Snowboardfahren')
    const person = rows.find((r) => r.responsibles.length)!.responsibles[0]!
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, q: person.toUpperCase() }).length).toBeGreaterThan(0)
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, q: 'zzzz-nix' })).toHaveLength(0)
  })

  it('filters by class, day, findings and missing responsibles', () => {
    const ls = filterRows(rows, { ...DEFAULT_ROW_FILTER, categoryClass: 'LS' })
    expect(ls.every((r) => r.categoryClass === 'LS')).toBe(true)
    const date = rows[0]!.entries[0]!.date
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, date }).every((r) => r.entries.some((e) => e.date === date))).toBe(true)
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, onlyFindings: true }).map((r) => r.iri)).toEqual([facts.activities[0]!.iri])
    expect(filterRows(rows, { ...DEFAULT_ROW_FILTER, noResponsible: true }).every((r) => r.responsibles.length === 0)).toBe(true)
  })

  it('compares dotted numbers numerically and puts empty ones last', () => {
    expect(compareNumbers('2.9', '2.10')).toBeLessThan(0)
    expect(compareNumbers('10.1', '9.1')).toBeGreaterThan(0)
    expect(compareNumbers(null, '1.1')).toBeGreaterThan(0)
  })

  it('sorts both directions, empty values last', () => {
    const asc = sortRows(rows, 'title', 'asc').map((r) => r.title)
    expect(sortRows(rows, 'title', 'desc').map((r) => r.title)).toEqual([...asc].reverse())
    const fake = [{ ...rows[0]!, location: '' }, { ...rows[0]!, iri: 'x', location: 'Berg' }]
    expect(sortRows(fake, 'location', 'desc')[1]!.location).toBe('')
    expect(sortRows(fake, 'location', 'asc')[1]!.location).toBe('')
  })
})

describe('url state', () => {
  it('round-trips and omits defaults', () => {
    expect(stateToQuery(stateFromQuery({}))).toEqual({})
    const s = { ...DEFAULT_ROW_FILTER, q: ' ski ', categoryClass: 'LA' as const, date: '2031-01-24', onlyFindings: true, noResponsible: true, sort: 'title' as const, dir: 'desc' as const }
    const q = stateToQuery(s, { other: '1' })
    expect(q).toEqual({ other: '1', q: 'ski', klasse: 'LA', tag: '2031-01-24', befunde: '1', ohneVerantw: '1', sort: 'title', dir: 'desc' })
    expect(stateFromQuery(q)).toEqual({ ...s, q: 'ski' })
  })

  it('ignores invalid values', () => {
    expect(stateFromQuery({ klasse: 'XX', tag: 'heute', sort: 'foo', dir: 'up' })).toEqual({
      ...DEFAULT_ROW_FILTER,
      sort: 'time',
      dir: 'asc',
    })
  })
})
