import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { evaluate } from '../../engine'
import { loadBundledPacks } from '../../packs'
import type { CtxOverrides } from '../factory'
import { FactsBuilder, makeCoachInputs, makeCtx, makeNds, msg, ruleMeta } from '../factory'
import { easterSunday } from '../../lib/holidays'

describe('holidays helper', () => {
  it('computes Easter', () => {
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2026)).toBe('2026-04-05')
  })
})

describe('JS-DL-04', () => {
  const f = new FactsBuilder({ start: '2027-07-12' }).facts
  const run = (date: string | null) => p['JS-DL-04'](makeCtx(f, { coachInputs: makeCoachInputs({ leihmaterialDeliveryDate: date }) }))
  it('fires on Auffahrt 2027-05-06 (holiday)', () => {
    const hits = run('2027-05-06')
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Feiertag')
  })
  it('fires on a Saturday', () => {
    const hits = run('2027-07-03')
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Samstag')
  })
  it('is silent on a Monday and without date', () => {
    expect(run('2027-07-05')).toEqual([])
    expect(run(null)).toEqual([])
    expect(p['JS-DL-04'](makeCtx(f))).toEqual([])
  })
})

describe('JS-DL-05', () => {
  // camp 2031-07-12 .. 2031-07-16
  const f = new FactsBuilder({ start: '2031-07-12', days: 5 }).facts
  const run = (now: string, nds = makeNds({ campAgendaUploaded: false }), campConfig?: CtxOverrides['campConfig']) =>
    p['JS-DL-05'](makeCtx(f, { now: new Date(now), nds, ...(campConfig ? { campConfig } : {}) }))
  it('is must/verified', () => {
    expect(ruleMeta('JS-DL-05')).toMatchObject({ severity: 'must', confidence: 'verified' })
  })
  it('hint before the camp end', () => {
    expect(run('2031-07-10T00:00:00Z')[0].severity).toBe('hint')
  })
  it('should 10 days after the camp end (due not passed)', () => {
    expect(run('2031-07-26T00:00:00Z')[0].severity).toBe('should')
  })
  it('must 31 days after the camp end without lastActivityDate', () => {
    const hits = run('2031-08-16T00:00:00Z')
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toContain('Frist 15.08.2031')
  })
  it('should 31 days after the end when lastActivityDate = end + 20', () => {
    const angebot = { other4DayCamp: null, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: '2031-08-05' }
    expect(run('2031-08-16T00:00:00Z', undefined, { angebot })[0].severity).toBe('should')
  })
  it('is silent when uploaded or NDS is not linked', () => {
    expect(run('2031-08-16T00:00:00Z', makeNds({ campAgendaUploaded: true }))).toEqual([])
    expect(run('2031-08-16T00:00:00Z', makeNds({ campAgendaUploaded: null }))).toEqual([])
    expect(p['JS-DL-05'](makeCtx(f, { now: new Date('2031-08-16T00:00:00Z') }))).toEqual([])
  })
})

describe('JS-DL-06', () => {
  const ordered = makeCoachInputs({ leihmaterialOrdered: true })
  const run = (start: string, days: number, inputs = ordered) =>
    p['JS-DL-06'](makeCtx(new FactsBuilder({ start, days }).facts, { coachInputs: inputs }))
  it('fires for a camp 2026-12-27…2027-01-02 with Leihmaterial', () => {
    const hits = run('2026-12-27', 7)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('11.12.2026')
    expect(msg(hits[0])).toContain('10.01.2027')
    expect(msg(hits[0])).toContain('04.11.2026')
  })
  it('fires for a camp starting 2027-01-15 (window starts 2027-01-08)', () => {
    expect(run('2027-01-15', 6)).toHaveLength(1)
  })
  it('is silent without Leihmaterial (flag false, no delivery date)', () => {
    expect(run('2027-01-15', 6, makeCoachInputs({ leihmaterialOrdered: false }))).toEqual([])
  })
  it('a delivery date alone counts as Leihmaterial in use', () => {
    expect(run('2027-01-15', 6, makeCoachInputs({ leihmaterialDeliveryDate: '2027-01-09' }))).toHaveLength(1)
  })
  it('is silent without overlap (camp 2026-08-01…10)', () => {
    expect(run('2026-08-01', 10)).toEqual([])
  })
  it('is not evaluated for camps from 2027-02 (validity)', () => {
    const ctx = makeCtx(new FactsBuilder({ start: '2027-02-15', days: 5 }).facts, { coachInputs: ordered })
    expect(evaluate(loadBundledPacks(), ctx).some((x) => x.ruleId === 'JS-DL-06')).toBe(false)
  })
})
