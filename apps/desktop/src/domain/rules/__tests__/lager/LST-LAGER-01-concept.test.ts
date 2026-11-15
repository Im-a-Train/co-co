import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeDoc } from '../factory'
import { ALL_CHECKS, docCheck } from './helpers'

/** The coach's «Sicherheitskonzept» flag on a document decides which file LST-LAGER-01 looks at. */
describe('LST-LAGER-01 concept document flag', () => {
  const f = new FactsBuilder().facts
  it('prefers the document the coach marked as safety concept over a named one', () => {
    const marked = makeDoc({ id: 'm1', name: 'notfall.pdf', safetyConcept: true, docCheck: docCheck(['hospital']) })
    const named = makeDoc({ id: 'k1', name: 'Sicherheitskonzept.pdf', docCheck: docCheck(ALL_CHECKS.filter((k) => k !== 'firstAid')) })
    expect(p['LST-LAGER-01'](makeCtx(f, { documents: [named, marked] }))[0].targets[1]).toBe('m1')
  })
  it('ignores documents the coach marked as not the safety concept', () => {
    const notConcept = makeDoc({ id: 'k1', name: 'Sicherheitskonzept_alt.pdf', safetyConcept: false, docCheck: docCheck(['hospital']) })
    const other = makeDoc({ id: 'd2', name: 'anderes.pdf', docCheck: docCheck(['emergencyNumbers']) })
    expect(p['LST-LAGER-01'](makeCtx(f, { documents: [notConcept, other] }))[0].targets[1]).toBe('d2')
    const only = p['LST-LAGER-01'](makeCtx(f, { documents: [notConcept] }))
    expect(only).toHaveLength(1)
    expect(only[0].targets).toEqual(['/api/camps/c1'])
  })
})
