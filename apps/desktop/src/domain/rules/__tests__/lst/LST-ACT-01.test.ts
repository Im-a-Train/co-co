import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_ES, CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { ids } from './helpers'

const flat = (text: string) => ({ content: { storyboardText: text, hasStoryboard: true } })

describe('LST-ACT-01', () => {
  it('LS «Filmabend» -> should', () => {
    const b = new FactsBuilder()
    const a = b.activity('Filmabend', CAT_LS, flat('Film schauen'))
    const hits = p['LST-ACT-01'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([a.iri])
    expect(msg(hits[0])).toContain('«Filmabend» ist als J+S-Aktivität eingeteilt, wirkt aber nicht sportlich-aktiv («filmabend»)')
  })
  it('«Singspiel mit Fangis» -> none (movement keyword)', () => {
    const b = new FactsBuilder()
    b.activity('Singspiel mit Fangis', CAT_LS, flat('Singen und rennen'))
    expect(p['LST-ACT-01'](makeCtx(b.facts))).toEqual([])
  })
  it('a movement keyword in the storyboard lifts the passive title', () => {
    const b = new FactsBuilder()
    b.activity('Filmabend', CAT_LS, flat('Zuerst Stafette, dann Film'))
    expect(p['LST-ACT-01'](makeCtx(b.facts))).toEqual([])
  })
  it('tagged js-aktivitaet -> none; non-J+S activities and no mapping -> none', () => {
    const b = new FactsBuilder()
    const tagged = b.activity('Filmabend', CAT_LS, flat('Film'))
    b.activity('Kino', CAT_ES, flat('Film'))
    expect(p['LST-ACT-01'](makeCtx(b.facts, { campConfig: { activityTags: { [tagged.iri]: ['js-aktivitaet'] } } }))).toEqual([])
    expect(p['LST-ACT-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
