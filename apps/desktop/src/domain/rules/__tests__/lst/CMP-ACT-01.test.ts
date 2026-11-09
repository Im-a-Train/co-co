import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx } from '../factory'
import { ids } from './helpers'

describe('CMP-ACT-01', () => {
  it('flags activities without responsibles', () => {
    const b = new FactsBuilder()
    const bad = b.activity('Ohne', CAT_LS, { responsible: false })
    b.activity('Mit', CAT_LS)
    expect(ids(p['CMP-ACT-01'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
  it('is silent for non-J+S camps', () => {
    const b = new FactsBuilder()
    b.activity('Ohne', CAT_LS, { responsible: false })
    expect(p['CMP-ACT-01'](makeCtx(b.facts, { coachInputs: makeCoachInputs({ isJsCamp: false }) }))).toEqual([])
  })
})
