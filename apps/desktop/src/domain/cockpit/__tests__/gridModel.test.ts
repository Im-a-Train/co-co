import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CampFacts, CategoryMapping, Finding } from '../../types'
import { bwzRequiredMinutes, computeJsDays, reportFromJsModel, thresholdsFromParams } from '../../rules/lib/jsDays'
import { CAT_LS, FactsBuilder, makeCtx } from '../../rules/__tests__/factory'
import { buildGrid, jsDayBars, severityStateColor } from '../index'

const finding = (id: string, ruleId: string, targets: string[], extra: Partial<Finding> = {}): Finding => ({
  id,
  ruleId,
  ruleVersion: '1',
  packId: 'p',
  severity: 'should',
  confidence: 'verified',
  title: id,
  message: id,
  scope: 'activity',
  targets,
  evidence: [],
  source: null,
  origin: 'rule',
  tags: [],
  override: null,
  ...extra,
})

function reportOf(facts: CampFacts, mapping: CategoryMapping | null) {
  const ctx = makeCtx(facts, { mapping })
  const t = thresholdsFromParams(ctx.params)
  return { ctx, report: reportFromJsModel(ctx.js, computeJsDays(facts, mapping, t), t, bwzRequiredMinutes(ctx.params)) }
}

describe('grid / bars / count agree (single J+S source)', () => {
  const FIXTURE = fileURLToPath(new URL('../../../__tests__/fixtures/camps/auf-in-die-berge.facts.json', import.meta.url))
  it('dev-camp fixture: valid grid days equal model.jsDayCount', () => {
    const facts = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as CampFacts
    const entries: CategoryMapping['entries'] = {}
    for (const c of facts.categories) entries[c.iri] = 'LS'
    const mapping: CategoryMapping = { campIri: facts.camp.iri, entries, confirmed: true, confirmedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }
    const { ctx, report } = reportOf(facts, mapping)
    const grid = buildGrid(facts, (c) => (c ? (mapping.entries[c] ?? 'NONE') : 'NONE'), report)
    // The legacy calculator pairs the end days on units + minutes and ignores the 2027 Bewegungszeit: it would
    // paint Tag 1 and the last day green. The model (and so the grid) does not.
    const t = thresholdsFromParams(ctx.params)
    expect(computeJsDays(facts, mapping, t).days[0].validCombined).toBe(true)
    expect(ctx.js.endDaysMode).toBe('none')
    expect(grid.days[0].valid).toBe(false)
    expect(grid.days[grid.days.length - 1].valid).toBe(false)
    expect(grid.days[0].invalidReasons).toContainEqual({ code: 'bwz', minutes: 0, required: 120 })
    const combined = ctx.js.endDaysMode === 'combined'
    const validDays = grid.days.filter((d) => d.valid)
    // a combined end-day pair counts once
    const gridCount = validDays.length - (combined ? 1 : 0)
    expect(gridCount).toBe(ctx.js.jsDayCount)
    expect(report.validDayCount).toBe(ctx.js.jsDayCount)
    expect(grid.summary).toEqual({ valid: ctx.js.jsDayCount, total: report.totalDayCount })
    expect(jsDayBars(report).filter((b) => b.valid).length - (combined ? 1 : 0)).toBe(ctx.js.jsDayCount)
  })

  it('camp whose end days fail the BWZ rule: bars, grid and count agree, with reasons', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
    b.facts.categories.push({ iri: CAT_LS, short: 'LS', name: 'LS', color: '#f00', numberingStyle: null })
    for (const d of [1, 2, 3, 4, 5]) {
      const end = d === 1 || d === 5
      b.entry(b.activity(`V${d}`, CAT_LS), d, '09:00', '11:00', { ys: end ? 40 : 60 })
      b.entry(b.activity(`N${d}`, CAT_LS), d, '14:00', '16:00', { ys: end ? null : 60 })
    }
    const mapping: CategoryMapping = { campIri: b.facts.camp.iri, entries: { [CAT_LS]: 'LS' }, confirmed: true, confirmedAt: null, updatedAt: '' }
    const { ctx, report } = reportOf(b.facts, mapping)
    const grid = buildGrid(b.facts, () => 'LS', report)
    expect(ctx.js.jsDayCount).toBe(3)
    expect(grid.days.map((d) => d.valid)).toEqual([false, true, true, true, false])
    expect(jsDayBars(report).map((x) => x.valid)).toEqual([false, true, true, true, false])
    expect(report.validDayCount).toBe(3)
    expect(grid.days[0].invalidReasons).toEqual([{ code: 'bwz', minutes: 40, required: 120 }])
    expect(jsDayBars(report)[0].reasons).toEqual(grid.days[0].invalidReasons)
    expect(grid.summary).toEqual({ valid: 3, total: 5 })
    expect(grid.preview).toBe(false)
  })
})

describe('buildGrid findings', () => {
  const b = new FactsBuilder({ start: '2026-07-12', days: 2 })
  b.facts.categories.push({ iri: CAT_LS, short: 'LS', name: 'LS', color: '#f00', numberingStyle: null })
  const a1 = b.activity('Ski', CAT_LS)
  const e1 = b.entry(a1, 1, '09:00', '11:00')
  const a2 = b.activity('Spiel', CAT_LS)
  b.entry(a2, 2, '09:00', '11:00')
  const d1 = b.dayIri(1)
  const findings = [
    finding('f1', 'X-1', [a1.iri], { severity: 'should' }),
    finding('f2', 'X-2', [e1.iri], { severity: 'must' }),
    finding('f2b', 'X-2', [a1.iri, e1.iri], { severity: 'must' }),
    finding('f3', 'X-3', [a1.iri], { severity: 'hint', override: { id: 'o', campIri: '', findingId: 'f3', ruleId: 'X-3', reason: '', createdAt: '' } as Finding['override'] }),
    finding('day-ignored', 'JS-DAY-01', [d1, b.dayIri(2)], { scope: 'day', override: { id: 'o2', campIri: '', findingId: 'day-ignored', ruleId: 'JS-DAY-01', reason: '', createdAt: '' } as Finding['override'] }),
    finding('coach', 'X-9', [a1.iri], { severity: 'hint', origin: 'manual' }),
    finding('day', 'JS-DAY-01', [d1], { scope: 'day' }),
    finding('prog', 'JS-PROG-02', [d1], { scope: 'day' }),
  ]
  const grid = buildGrid(b.facts, () => 'LS', null, {
    findings,
    preview: true,
    isExcluded: (act) => act === a2.iri,
  })

  it('counts open findings on the activity or its entries, once, without day findings and coach findings (like the DP chips)', () => {
    expect(grid.days[0].blocks[0].findings).toEqual({ must: 2, should: 1, hint: 0 })
    expect(grid.days[1].blocks[0].findings).toEqual({ must: 0, should: 0, hint: 0 })
  })
  it('attaches the JS-DAY finding to the day (open first, else ignored) and flags excluded blocks', () => {
    expect(grid.days[0].findingId).toBe('day')
    expect(grid.days[1].findingId).toBe('day-ignored')
    expect(buildGrid(b.facts, () => 'LS', null).days[0].findingId).toBeNull()
    expect(grid.days[0].blocks[0].excluded).toBe(false)
    expect(grid.days[1].blocks[0].excluded).toBe(true)
  })
  it('preview flag is passed through; no report means no summary', () => {
    expect(grid.preview).toBe(true)
    expect(grid.summary).toBeNull()
  })
})

describe('severityStateColor (GP badge = DP chips)', () => {
  it('colours open Muss red and open Soll orange; a Hinweis gets no colour', () => {
    expect(severityStateColor('must')).toBe('error')
    expect(severityStateColor('should')).toBe('warning')
    expect(severityStateColor('hint')).toBeNull()
  })
})
