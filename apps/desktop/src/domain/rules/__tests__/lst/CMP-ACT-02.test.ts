import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LA, CAT_LS, FactsBuilder, makeCtx } from '../factory'
import { ids } from './helpers'

describe('CMP-ACT-02', () => {
  it('flags J+S activities with neither storyboard nor notes text', () => {
    const b = new FactsBuilder()
    const bad = b.activity('LS leer', CAT_LS, { content: { hasStoryboard: false, storyboardText: '' } })
    const blank = b.activity('LA blank', CAT_LA, { content: { hasStoryboard: true, storyboardText: '  ' } })
    b.activity('Essen leer', CAT_ES, { content: { hasStoryboard: false, storyboardText: '' } })
    b.activity('LS voll', CAT_LS)
    expect(ids(p['CMP-ACT-02'](makeCtx(b.facts)))).toEqual([bad.iri, blank.iri])
  })
  it('accepts a notes text instead of a storyboard', () => {
    const b = new FactsBuilder()
    b.activity('LS Notizen', CAT_LS, { content: { hasStoryboard: false, storyboardText: '', notesText: 'Ablauf: Spiel, dann Posten' } })
    expect(p['CMP-ACT-02'](makeCtx(b.facts))).toEqual([])
  })
  it('respects tags and is silent without mapping', () => {
    const b = new FactsBuilder()
    const es = b.activity('Essen', CAT_ES, { content: { hasStoryboard: false, storyboardText: '' } })
    const ls = b.activity('LS', CAT_LS, { content: { hasStoryboard: false, storyboardText: '' } })
    const ctx = makeCtx(b.facts, { campConfig: { activityTags: { [es.iri]: ['js-aktivitaet'], [ls.iri]: ['keine-js-aktivitaet'] } } })
    expect(ids(p['CMP-ACT-02'](ctx))).toEqual([es.iri])
    expect(p['CMP-ACT-02'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
