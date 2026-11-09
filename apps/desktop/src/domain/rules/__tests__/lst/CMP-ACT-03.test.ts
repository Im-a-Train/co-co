import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LA, FactsBuilder, makeCtx } from '../factory'
import { ids } from './helpers'

describe('CMP-ACT-03', () => {
  it('risk activities without safety text -> should, other J+S activities -> hint', () => {
    const b = new FactsBuilder()
    const outdoor = b.activity('Geländespiel im Wald', CAT_LA)
    const water = b.activity('Baden im See', CAT_LA)
    const fire = b.activity('Bräteln am Feuer', CAT_LA)
    const night = b.activity('Nachtübung', CAT_LA)
    const plain = b.activity('Basteln', CAT_LA)
    b.activity('Wald mit Sicherheit', CAT_LA, { content: { safetyText: 'Erste Hilfe dabei', hasSafetyConsiderations: true } })
    b.activity('Essen im Wald', CAT_ES)
    const hits = p['CMP-ACT-03'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([outdoor.iri, water.iri, fire.iri, night.iri, plain.iri])
    expect(hits.map((h) => h.severity)).toEqual([undefined, undefined, undefined, undefined, 'hint'])
  })
  it('sb-* and ebb-* tags make an activity a risk activity', () => {
    const b = new FactsBuilder()
    const a = b.activity('Programmblock', CAT_LA)
    const c = b.activity('Block 2', CAT_LA)
    const ctx = makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['sb-berg'], [c.iri]: ['ebb-b'] } } })
    expect(p['CMP-ACT-03'](ctx).map((h) => h.severity)).toEqual([undefined, undefined])
  })
  it('is silent without mapping', () => {
    const b = new FactsBuilder()
    b.activity('Geländespiel', CAT_LA)
    expect(p['CMP-ACT-03'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
