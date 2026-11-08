import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids, Y2026 } from './helpers'

describe('JS-DAY-02', () => {
  it('flags J+S entries under 30 minutes, accepts exactly 30', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    const e = b.entry(b.activity('Kurz', CAT_LS), 2, '09:00', '09:29')
    b.entry(b.activity('Genau', CAT_LS), 2, '12:00', '12:30')
    const hits = p['JS-DAY-02'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([e.iri])
    expect(hits[0].params).toMatchObject({ title: 'Kurz', minutes: 29, min: 30 })
  })
  it('ignores non-J+S entries, honours tags, silent without mapping', () => {
    const b = new FactsBuilder({ start: Y2026, days: 3 })
    const es = b.activity('Essen', CAT_ES)
    b.entry(es, 2, '12:00', '12:20')
    const tagged = b.activity('Frei', CAT_LS)
    b.entry(tagged, 2, '14:00', '14:10')
    expect(p['JS-DAY-02'](makeCtx(b.facts, { campConfig: { activityTags: { [tagged.iri]: ['keine-js-aktivitaet'] } } }))).toEqual([])
    const fromTag = makeCtx(b.facts, { campConfig: { activityTags: { [es.iri]: ['js-aktivitaet'] } } })
    expect(p['JS-DAY-02'](fromTag)).toHaveLength(2) // tagged Essen (20 min) + LS Frei (10 min)
    expect(p['JS-DAY-02'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
