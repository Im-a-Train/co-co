import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeNds, msg, ruleMeta } from '../factory'

const f = new FactsBuilder().facts
const rega = (participantsTotal: number, participantsTransmitted: number) => ({
  participantsTotal,
  participantsTransmitted,
  supervisorsTotal: 3,
  supervisorsTransmitted: 3,
})

describe('CMP-NDS-04 Rega registration', () => {
  it('has the expected metadata', () => {
    expect(ruleMeta('CMP-NDS-04')).toMatchObject({ kind: 'hard', severity: 'hint', confidence: 'unverified', module: 'js', scope: 'camp' })
  })
  it('is silent without NDS or without Rega counts', () => {
    expect(p['CMP-NDS-04'](makeCtx(f))).toEqual([])
    expect(p['CMP-NDS-04'](makeCtx(f, { nds: makeNds({ rega: null }) }))).toEqual([])
    expect(p['CMP-NDS-04'](makeCtx(f, { nds: makeNds() }))).toEqual([])
  })
  it('is silent when everyone is transmitted (or there are no participants)', () => {
    expect(p['CMP-NDS-04'](makeCtx(f, { nds: makeNds({ rega: rega(12, 12) }) }))).toEqual([])
    expect(p['CMP-NDS-04'](makeCtx(f, { nds: makeNds({ rega: rega(0, 0) }) }))).toEqual([])
  })
  it('flags missing registrations with counts, red-derived inputs and NDS evidence', () => {
    const hits = p['CMP-NDS-04'](makeCtx(f, { nds: makeNds({ rega: rega(12, 9) }) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].params).toMatchObject({ missing: 3, total: 12 })
    expect(hits[0].redKeys).toEqual(['regaMissing', 'regaTotal'])
    expect(hits[0].evidence).toHaveLength(1)
    expect(msg('CMP-NDS-04', hits[0])).toContain('3 von 12 Teilnehmenden nicht an die Rega übermittelt')
  })
})
