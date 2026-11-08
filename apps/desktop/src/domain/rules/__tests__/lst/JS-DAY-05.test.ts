import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LA, CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids, Y2026 } from './helpers'

describe('JS-DAY-05', () => {
  it('flags J+S activities without a warm-up keyword at the start of the storyboard', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    const bad = b.activity('Ohne', CAT_LS, { content: { storyboardText: 'Hauptteil: Postenlauf.' + ' x'.repeat(300) + ' Am Ende Aufwärmen' } })
    const ok = b.activity('Mit', CAT_LA, { content: { storyboardText: 'Einstimmen: Kreisspiel' } })
    const empty = b.activity('Leer', CAT_LS, { content: { storyboardText: '', hasStoryboard: false } })
    for (const a of [bad, ok, empty]) b.entry(a, 2, '09:00', '11:00')
    expect(ids(p['JS-DAY-05'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
  it('the head length is a param: a warm-up beyond lst.warmupHeadChars does not count', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    const a = b.activity('Spät', CAT_LS, { content: { storyboardText: 'Hauptteil dann Aufwärmen' } })
    b.entry(a, 2, '09:00', '11:00')
    expect(p['JS-DAY-05'](makeCtx(b.facts))).toEqual([])
    expect(p['JS-DAY-05'](makeCtx(b.facts, { paramValues: { 'lst.warmupHeadChars': 10 } }))).toHaveLength(1)
  })
  it('is silent without mapping and for non-J+S activities', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    b.entry(b.activity('Ohne', CAT_LS, { content: { storyboardText: 'Hauptteil' } }), 2, '09:00', '11:00')
    expect(p['JS-DAY-05'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
