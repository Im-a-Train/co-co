import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeMidata, msg, ruleMeta } from '../factory'

const f = new FactsBuilder({ start: '2027-07-12' }).facts
const run = (byYear: Record<number, number> | undefined) =>
  p['JS-AGE-01'](makeCtx(f, { midata: makeMidata({ participantsByBirthYear: byYear }) }))

describe('JS-AGE-01', () => {
  it('is hint/verified', () => {
    expect(ruleMeta('JS-AGE-01')).toMatchObject({ severity: 'hint', confidence: 'verified' })
  })
  it('fires for one participant born 2006 (too old in 2027)', () => {
    const hits = run({ 2006: 1, 2010: 12 })
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('1 Teilnehmende liegen ausserhalb des J+S-Alters')
    expect(msg(hits[0])).toContain('Jahrgänge 2007–2022')
    expect(hits[0].redKeys).toContain('participantsOutsideJsAge')
  })
  it('fires for one participant born 2023 (too young)', () => {
    expect(run({ 2023: 1, 2010: 12 })).toHaveLength(1)
  })
  it('is silent when everyone is born 2007–2022', () => {
    expect(run({ 2007: 3, 2015: 5, 2022: 4 })).toEqual([])
  })
  it('is silent without Jahrgang data and without MiData', () => {
    expect(run(undefined)).toEqual([])
    expect(p['JS-AGE-01'](makeCtx(f))).toEqual([])
  })
})
