import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, makeDoc, msg, ruleMeta } from '../factory'
import { ALL_CHECKS, docCheck } from './helpers'

describe('LST-LAGER-01', () => {
  const f = new FactsBuilder().facts
  it('metadata: should/heuristic, replaces SAFE-DOC-01', () => {
    const m = ruleMeta('LST-LAGER-01')
    expect(m).toMatchObject({ severity: 'should', confidence: 'heuristic', module: 'lst-lager' })
    expect(m.formerIds).toContain('SAFE-DOC-01')
  })
  it('no documents (or none with a check) -> should', () => {
    for (const documents of [[], [makeDoc()]]) {
      const hits = p['LST-LAGER-01'](makeCtx(f, { documents }))
      expect(hits).toHaveLength(1)
      expect(msg(hits[0])).toBe('Kein Sicherheitskonzept für das Lager gefunden.')
    }
  })
  it('concept without the hospital item -> incomplete', () => {
    const doc = makeDoc({ id: 'k1', name: 'Sicherheitskonzept.pdf', docCheck: docCheck(ALL_CHECKS.filter((k) => k !== 'hospital')) })
    const hits = p['LST-LAGER-01'](makeCtx(f, { documents: [doc] }))
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('incomplete')
    expect(hits[0].targets).toEqual(['/api/camps/c1', 'k1'])
    expect(msg(hits[0])).toBe('Im Sicherheitskonzept fehlen: Spital.')
  })
  it('prefers a document named like a concept over a higher-scoring one', () => {
    const named = makeDoc({ id: 'k1', name: 'Sicherheitskonzept.pdf', docCheck: docCheck(['hospital']) })
    const other = makeDoc({ id: 'k2', name: 'anderes.pdf', docCheck: docCheck(ALL_CHECKS) })
    expect(p['LST-LAGER-01'](makeCtx(f, { documents: [other, named] }))[0].targets[1]).toBe('k1')
  })
  it('falls back to the document with the most items found', () => {
    const partial = makeDoc({ id: 'd1', docCheck: docCheck(['emergencyNumbers', 'hospital']) })
    const worse = makeDoc({ id: 'd2', docCheck: docCheck([]) })
    const hits = p['LST-LAGER-01'](makeCtx(f, { documents: [worse, partial] }))
    expect(hits[0].targets[1]).toBe('d1')
    expect(msg(hits[0])).toContain('Krisenkontakt')
    expect(msg(hits[0])).not.toContain('Notrufnummern')
  })
  it('complete concept -> none', () => {
    expect(p['LST-LAGER-01'](makeCtx(f, { documents: [makeDoc({ docCheck: docCheck(ALL_CHECKS) })] }))).toEqual([])
  })
  it('riskNotNamed: risk activities missing in the concept text -> hint', () => {
    const b = new FactsBuilder()
    b.activity('Baden im Aaresee', CAT_LS)
    b.activity('Basteln', CAT_LS)
    const text = 'Sicherheitskonzept. Notfall: 144 anrufen.'
    const doc = makeDoc({ name: 'Sicherheitskonzept.pdf', text, docCheck: docCheck(ALL_CHECKS) })
    const hits = p['LST-LAGER-01'](makeCtx(b.facts, { documents: [doc] }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ variant: 'riskNotNamed', severity: 'hint' })
    expect(msg(hits[0])).toBe('Aktivitäten mit erhöhten Sicherheitsanforderungen sind im Konzept nicht erwähnt: Baden im Aaresee.')
    const covered = makeDoc({ name: 'Sicherheitskonzept.pdf', text: `${text} Beim Baden gilt die Badeordnung.`, docCheck: docCheck(ALL_CHECKS) })
    expect(p['LST-LAGER-01'](makeCtx(b.facts, { documents: [covered] }))).toEqual([])
  })
  it('riskNotNamed counts coach tags (sb-*)', () => {
    const b = new FactsBuilder()
    const a = b.activity('Tour', CAT_LS)
    const doc = makeDoc({ name: 'Sicherheitskonzept.pdf', text: 'Notfallkonzept allgemein', docCheck: docCheck(ALL_CHECKS) })
    const hits = p['LST-LAGER-01'](makeCtx(b.facts, { documents: [doc], campConfig: { activityTags: { [a.iri]: ['sb-berg'] } } }))
    expect(hits.map((h) => h.variant)).toEqual(['riskNotNamed'])
  })
})
