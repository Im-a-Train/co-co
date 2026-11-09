import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids } from './helpers'

const empty = { content: { storyboardText: '', hasStoryboard: false } }

describe('LST-ACT-05', () => {
  it('«Programmblock A» -> hint; «Seilbrücke bauen» (EF1) -> none', () => {
    const b = new FactsBuilder()
    const bad = b.activity('Programmblock A', CAT_LS, empty)
    b.activity('Seilbrücke bauen', CAT_LS, empty)
    expect(ids(p['LST-ACT-05'](makeCtx(b.facts)))).toEqual([bad.iri])
  })
  it('an ef* tag satisfies the rule; keywords in the storyboard count too', () => {
    const b = new FactsBuilder()
    const tagged = b.activity('Programmblock B', CAT_LS, empty)
    b.activity('Block C', CAT_LS, { content: { storyboardText: 'Wir lernen Kompass und Karte', hasStoryboard: true } })
    expect(p['LST-ACT-05'](makeCtx(b.facts, { campConfig: { activityTags: { [tagged.iri]: ['ef4'] } } }))).toEqual([])
  })
  it('non-J+S activities and no mapping -> none', () => {
    const b = new FactsBuilder()
    b.activity('Programmblock A', CAT_ES, empty)
    expect(p['LST-ACT-05'](makeCtx(b.facts))).toEqual([])
    const c = new FactsBuilder()
    c.activity('Programmblock A', CAT_LS, empty)
    expect(p['LST-ACT-05'](makeCtx(c.facts, { mapping: null }))).toEqual([])
  })
})
